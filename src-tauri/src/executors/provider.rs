use crate::errors::AppError;
use crate::models::{AccountItem, ProviderDescriptor};
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct ProviderTaskParams {
    pub task_id: String,
    pub kind: String, // "text_to_video", "image_to_video", "text_to_image", "image_to_image"
    pub prompt: String,
    pub ratio: Option<String>,
    pub input_path: Option<String>,
    pub output_dir: String,
    pub model: Option<String>,
    pub duration_sec: Option<f32>,
}

#[derive(Debug, Clone)]
pub struct ProviderTaskResult {
    pub output_file: PathBuf,
    pub observed_model: Option<String>,
    pub remote_job_id: Option<String>,
    pub session_id: Option<String>,
    pub verification_notes: Option<String>,
}

#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    /// Định danh provider
    fn id(&self) -> &str;

    /// Thông tin capability matrix và các model hỗ trợ
    fn descriptor(&self) -> ProviderDescriptor;

    /// Kiểm tra tính hợp lệ của tham số với capability matrix trước khi submit
    fn validate_task_params(&self, params: &ProviderTaskParams) -> Result<(), AppError> {
        let desc = self.descriptor();
        let target_model_id = params
            .model
            .as_deref()
            .unwrap_or(&desc.default_model);

        let cap = desc
            .models
            .iter()
            .find(|m| m.id == target_model_id)
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "Model '{}' không được hỗ trợ bởi provider '{}'",
                    target_model_id,
                    self.id()
                ))
            })?;

        // Kiểm tra operation
        if !cap.supported_operations.contains(&params.kind) {
            return Err(AppError::Validation(format!(
                "Operation '{}' không được hỗ trợ bởi model '{}'",
                params.kind, target_model_id
            )));
        }

        // Kiểm tra ratio nếu có
        if let Some(ref r) = params.ratio {
            if !cap.supported_ratios.contains(r) {
                return Err(AppError::Validation(format!(
                    "Tỉ lệ khung hình '{}' không được hỗ trợ bởi model '{}'. Hỗ trợ: {:?}",
                    r, target_model_id, cap.supported_ratios
                )));
            }
        }

        Ok(())
    }

    /// Kiểm tra session / đăng nhập của account
    async fn check_session(&self, account: &AccountItem) -> Result<(bool, String), AppError>;

    /// Thực thi tác vụ sinh media qua provider
    async fn execute_task(
        &self,
        account: &AccountItem,
        params: &ProviderTaskParams,
        progress_cb: Box<dyn Fn(u32, Option<String>) + Send + Sync>,
        token: &CancellationToken,
    ) -> Result<ProviderTaskResult, AppError>;
}

/// Registry tập trung quản lý các Provider adapters
pub struct ProviderRegistry {
    adapters: Arc<Mutex<HashMap<String, Arc<dyn ProviderAdapter>>>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            adapters: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn register(&self, adapter: Arc<dyn ProviderAdapter>) {
        let mut map = self.adapters.lock().await;
        map.insert(adapter.id().to_string(), adapter);
    }

    pub async fn get(&self, provider_id: &str) -> Option<Arc<dyn ProviderAdapter>> {
        let map = self.adapters.lock().await;
        map.get(provider_id).cloned()
    }

    pub async fn list_descriptors(&self) -> Vec<ProviderDescriptor> {
        let map = self.adapters.lock().await;
        map.values().map(|a| a.descriptor()).collect()
    }
}
