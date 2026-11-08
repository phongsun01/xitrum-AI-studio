use crate::db::Database;
use crate::errors::AppError;
use crate::executors::muse_runner::{MuseRunner, ProxyConfig};
use crate::executors::provider::{ProviderAdapter, ProviderTaskParams, ProviderTaskResult};
use crate::models::{AccountItem, ModelCapability, ProviderDescriptor};
use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct MuseAdapter {
    runner: Arc<Mutex<MuseRunner>>,
    db: Arc<Database>,
}

impl MuseAdapter {
    pub fn new(runner: Arc<Mutex<MuseRunner>>, db: Arc<Database>) -> Self {
        Self { runner, db }
    }

    fn resolve_proxy_config(&self, account: &AccountItem) -> Option<ProxyConfig> {
        let proxy_id = account.proxy_id?;
        let p = self.db.get_proxy(proxy_id).ok().flatten()?;

        // Đọc secret mật khẩu từ OS Keychain/DPAPI
        let decrypted_pass = if let Ok(Some(secret)) =
            crate::secret_store::SecretStore::get_secret(&format!("proxy_{}", p.id))
        {
            Some(secret)
        } else {
            p.encrypted_password.as_ref().map(|enc| {
                use base64::{engine::general_purpose, Engine as _};
                if let Ok(bytes) = general_purpose::STANDARD.decode(enc) {
                    let salt = b"xitrum_secret_salt_2026";
                    let mut unxored = Vec::new();
                    for (i, b) in bytes.iter().enumerate() {
                        unxored.push(b ^ salt[i % salt.len()]);
                    }
                    String::from_utf8_lossy(&unxored).to_string()
                } else {
                    enc.clone()
                }
            })
        };

        Some(ProxyConfig {
            server: format!("{}://{}:{}", p.scheme, p.host, p.port),
            username: p.username,
            password: decrypted_pass,
        })
    }
}

#[async_trait]
impl ProviderAdapter for MuseAdapter {
    fn id(&self) -> &str {
        "muse"
    }

    fn descriptor(&self) -> ProviderDescriptor {
        ProviderDescriptor {
            id: "muse".into(),
            name: "Muse.ai".into(),
            connection_modes: vec!["muse_web".into()],
            default_model: "muse_default".into(),
            models: vec![
                ModelCapability {
                    id: "muse_default".into(),
                    name: "Muse Standard Generator".into(),
                    supported_operations: vec![
                        "text_to_video".into(),
                        "image_to_video".into(),
                        "text_to_image".into(),
                        "image_to_image".into(),
                    ],
                    supported_ratios: vec!["16:9".into(), "9:16".into(), "1:1".into()],
                    supported_durations_sec: vec![5.0],
                    max_input_images: 1,
                    native_audio: false,
                    supports_resume: false,
                    supports_cancel: true,
                    verified: true,
                },
            ],
        }
    }

    async fn check_session(&self, account: &AccountItem) -> Result<(bool, String), AppError> {
        let proxy = self.resolve_proxy_config(account);
        let mut runner = self.runner.lock().await;
        let config = self.db.get_config().unwrap_or_default();

        let profile = account.profile_path.clone().or_else(|| Some(config.chrome_profile_dir));
        runner
            .check_session(profile, config.chrome_path, proxy)
            .await
            .map_err(|e| AppError::Other(e.to_string()))
    }

    async fn execute_task(
        &self,
        account: &AccountItem,
        params: &ProviderTaskParams,
        progress_cb: Box<dyn Fn(u32, Option<String>) + Send + Sync>,
        token: &CancellationToken,
    ) -> Result<ProviderTaskResult, AppError> {
        self.validate_task_params(params)?;

        let proxy = self.resolve_proxy_config(account);
        let config = self.db.get_config().unwrap_or_default();
        let profile = account.profile_path.clone().or_else(|| Some(config.chrome_profile_dir));

        let kind_str = match params.kind.as_str() {
            "text_to_image" | "image_to_image" => "muse_image",
            _ => "muse_video",
        };

        let mut runner = self.runner.lock().await;
        let out_file = runner
            .execute_task(
                &params.task_id,
                kind_str,
                &params.prompt,
                params.ratio.as_deref(),
                params.input_path.as_deref(),
                &params.output_dir,
                profile.as_deref(),
                config.chrome_path.as_deref(),
                proxy,
                move |p, msg| {
                    progress_cb(p, msg);
                },
                token,
            )
            .await
            .map_err(|e| AppError::Other(e.to_string()))?;

        Ok(ProviderTaskResult {
            output_file: out_file,
            observed_model: Some("muse_default".to_string()),
            remote_job_id: None,
            session_id: Some(account.id.clone()),
            verification_notes: Some("Đã xác thực qua Playwright Web Automation".to_string()),
        })
    }
}

