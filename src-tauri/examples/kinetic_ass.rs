//! Generate an ASS file using the same engine as the desktop export.
use xitrum_ai_studio_lib::{kinetic_subtitles::KineticGenerator, models::{SubtitlePreset, SubtitleStyleConfig}};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        return Err("Usage: kinetic_ass <srt> <width> <height> <offset_ms>".into());
    }
    let width = args[2].parse()?;
    let height = args[3].parse()?;
    let style = SubtitleStyleConfig::from_preset(SubtitlePreset::NotionWhiteboard, height > width);
    let path = KineticGenerator::convert_srt_to_kinetic_ass(
        std::path::Path::new(&args[1]), &style, "&H0000FFFF", width, height, args[4].parse()?,
    )?;
    println!("{}", path.display());
    Ok(())
}
