use tauri::{
  plugin::{Builder, TauriPlugin},
  Runtime,
};

pub use models::*;
mod error;
mod models;
pub use error::{Error, Result};

#[cfg(target_os = "ios")]
mod ios_impl {
  use super::*;
  use tauri::{
    plugin::PluginHandle,
    Manager, Runtime,
  };

  tauri::ios_plugin_binding!(init_plugin_document_scanner);

  pub struct DocumentScanner<R: Runtime>(pub PluginHandle<R>);

  impl<R: Runtime> DocumentScanner<R> {
    pub fn is_available(&self) -> Result<bool> {
      #[derive(serde::Deserialize)]
      struct AvailableResponse {
        available: bool,
      }
      self
        .0
        .run_mobile_plugin::<AvailableResponse>("isAvailable", ())
        .map(|r| r.available)
        .map_err(Into::into)
    }

    pub fn scan(&self, options: ScanOptions) -> Result<ScanResult> {
      self
        .0
        .run_mobile_plugin("scan", options)
        .map_err(Into::into)
    }
  }

  pub fn setup_ios<R: Runtime>(
    app: &tauri::AppHandle<R>,
    api: tauri::plugin::PluginApi<R, ()>,
  ) -> tauri::Result<()> {
    let handle = api.register_ios_plugin(init_plugin_document_scanner)?;
    app.manage(DocumentScanner(handle));
    Ok(())
  }
}

#[tauri::command]
async fn is_available<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool> {
  #[cfg(target_os = "ios")]
  {
    use tauri::Manager;
    app.state::<ios_impl::DocumentScanner<R>>().is_available()
  }
  #[cfg(not(target_os = "ios"))]
  {
    let _ = app;
    Ok(false)
  }
}

#[tauri::command]
async fn scan<R: Runtime>(
  app: tauri::AppHandle<R>,
  options: Option<ScanOptions>,
) -> Result<ScanResult> {
  #[cfg(target_os = "ios")]
  {
    use tauri::Manager;
    app.state::<ios_impl::DocumentScanner<R>>().scan(options.unwrap_or(ScanOptions {
      max_pages: Some(8),
    }))
  }
  #[cfg(not(target_os = "ios"))]
  {
    let _ = (app, options);
    Err(Error::Message(
      "native_document_scanner_unavailable".into(),
    ))
  }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("document-scanner")
    .invoke_handler(tauri::generate_handler![is_available, scan])
    .setup(|app, api| {
      #[cfg(target_os = "ios")]
      {
        ios_impl::setup_ios(app, api)?;
      }
      #[cfg(not(target_os = "ios"))]
      {
        let _ = (app, api);
      }
      Ok(())
    })
    .build()
}
