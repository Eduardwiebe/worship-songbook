const COMMANDS: &[&str] = &["scan", "is_available"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .ios_path("ios")
    .build();
}
