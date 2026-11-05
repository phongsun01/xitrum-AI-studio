use anyhow::Result;
use image::{imageops::FilterType, GenericImageView, Rgba, RgbaImage};
use ndarray::Array4;
use ort::session::Session;
use ort::value::Tensor;
use std::path::Path;
use std::sync::Mutex;

pub struct RembgEngine {
    session: Mutex<Session>,
}

impl RembgEngine {
    pub fn new<P: AsRef<Path>>(model_path: P) -> Result<Self> {
        let environment = ort::init()
            .with_name("rembg_worker")
            .build()
            .map_err(|e| anyhow::anyhow!("Env error: {e}"))?;

        let session = Session::builder(&environment)
            .map_err(|e| anyhow::anyhow!("Session builder error: {e}"))?
            .commit_from_file(model_path)
            .map_err(|e| anyhow::anyhow!("Commit model error: {e}"))?;

        Ok(Self {
            session: Mutex::new(session),
        })
    }

    pub fn remove_background<P1: AsRef<Path>, P2: AsRef<Path>>(
        &self,
        input_path: P1,
        output_path: P2,
    ) -> Result<()> {
        let original_img = image::open(input_path)?;
        let (orig_w, orig_h) = original_img.dimensions();

        let resized = original_img.resize_exact(320, 320, FilterType::Triangle);
        let rgb = resized.to_rgb8();

        let mean = [0.485f32, 0.456, 0.406];
        let std = [0.229f32, 0.224, 0.225];

        let mut tensor_data = Array4::<f32>::zeros((1, 3, 320, 320));
        for y in 0..320 {
            for x in 0..320 {
                let pixel = rgb.get_pixel(x, y);
                for c in 0..3 {
                    let val = (pixel[c] as f32) / 255.0;
                    tensor_data[[0, c, y as usize, x as usize]] = (val - mean[c]) / std[c];
                }
            }
        }

        let input_tensor = Tensor::from_array(tensor_data)
            .map_err(|e| anyhow::anyhow!("Tensor error: {e}"))?;

        let mut session_guard = self.session.lock().unwrap();
        let outputs = session_guard
            .run(ort::inputs![input_tensor])
            .map_err(|e| anyhow::anyhow!("Inference error: {e}"))?;

        let (_shape, output_slice) = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| anyhow::anyhow!("Extract tensor error: {e}"))?;

        let mut min_val = f32::MAX;
        let mut max_val = f32::MIN;
        for &val in output_slice {
            if val < min_val {
                min_val = val;
            }
            if val > max_val {
                max_val = val;
            }
        }
        let range = (max_val - min_val).max(1e-6);

        let mut mask_img = image::GrayImage::new(320, 320);
        for y in 0..320 {
            for x in 0..320 {
                let idx = (y * 320 + x) as usize;
                let val = output_slice[idx];
                let normalized = ((val - min_val) / range * 255.0).clamp(0.0, 255.0) as u8;
                mask_img.put_pixel(x as u32, y as u32, image::Luma([normalized]));
            }
        }

        let full_mask = image::imageops::resize(&mask_img, orig_w, orig_h, FilterType::Triangle);
        let mut result_img = RgbaImage::new(orig_w, orig_h);
        let orig_rgba = original_img.to_rgba8();

        for y in 0..orig_h {
            for x in 0..orig_w {
                let p = orig_rgba.get_pixel(x, y);
                let alpha = full_mask.get_pixel(x, y)[0];
                result_img.put_pixel(x, y, Rgba([p[0], p[1], p[2], alpha]));
            }
        }

        result_img.save(output_path)?;
        Ok(())
    }
}

