//! Native static SVG rasterization. The app only sends sanitized, bundled art.
//! Default sprites still use the reference compiler; this handles edited SVGs.
use jni::{objects::{JClass, JString}, sys::{jbyteArray, jint}, JNIEnv};
use resvg::{tiny_skia, usvg};
use std::{panic::{catch_unwind, AssertUnwindSafe}, ptr, sync::{Arc, OnceLock}};

fn raster(svg: &str, w: u32, h: u32) -> Option<Vec<u8>> {
    if w == 0 || h == 0 || w > 1536 || h > 1536 || svg.len() > 1_000_000 {
        return None;
    }
    let mut options = usvg::Options::default();
    // Share immutable font data across animation frames. Only explicit OS files are read.
    static FONTS: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    options.fontdb = FONTS.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        for path in ["/system/fonts/Roboto-Regular.ttf", "/system/fonts/NotoSans-Regular.ttf", "/system/fonts/NotoSansCJK-Regular.ttc"] {
            if let Ok(data) = std::fs::read(path) { db.load_font_data(data); }
        }
        Arc::new(db)
    }).clone();
    options.font_family = "Roboto".to_owned();
    let tree = usvg::Tree::from_str(svg, &options).ok()?;
    let mut pixmap = tiny_skia::Pixmap::new(w, h)?;
    let s = tree.size();
    let transform = tiny_skia::Transform::from_scale(w as f32 / s.width(), h as f32 / s.height());
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    if !pixmap.data().chunks_exact(4).any(|p| p[3] != 0) {
        return None;
    }
    pixmap.encode_png().ok()
}

#[no_mangle]
pub extern "system" fn Java_com_elementeracoast_app_feature_daily_NativeSvgRaster_renderPng(
    mut env: JNIEnv<'_>, _class: JClass<'_>, svg: JString<'_>, w: jint, h: jint,
) -> jbyteArray {
    if w <= 0 || h <= 0 || w > 1536 || h > 1536 {
        return ptr::null_mut();
    }
    let output = catch_unwind(AssertUnwindSafe(|| {
        let input: String = env.get_string(&svg).ok()?.into();
        raster(&input, w as u32, h as u32)
    })).ok().flatten();
    match output {
        Some(bytes) => env.byte_array_from_slice(&bytes).map(|a| a.into_raw()).unwrap_or(ptr::null_mut()),
        None => ptr::null_mut(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paints_and_rejects_empty_or_oversized() {
        let input = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#cc8844"/></svg>"##;
        assert!(raster(input, 20, 20).is_some());
        assert!(raster(input, 0, 20).is_none());
        assert!(raster(input, 1537, 20).is_none());
    }
}

/** Open only a private temporary copy of the obsolete WebView LevelDB.
 * No browser is started and no other origin or storage key is enumerated.
 * An empty byte array means a successful read with no matching record;
 * null means the database could not be read or the record was ambiguous.
 */
fn read_legacy_studio(path: &str) -> Option<Vec<u8>> {
    let mut options = rusty_leveldb::Options::default();
    options.create_if_missing = false;
    options.paranoid_checks = true;
    let mut db = rusty_leveldb::DB::open(path, options).ok()?;
    let snapshot = db.get_snapshot();
    let mut found: Option<Vec<u8>> = None;
    for origin in [b"_https://rest-studio.invalid\0".as_slice(), b"_https://rest-studio.invalid/\0".as_slice()] {
        let mut keys = Vec::new();
        let mut latin = origin.to_vec();
        latin.push(1);
        latin.extend_from_slice(b"rest-box.studio.v1");
        keys.push(latin);
        let mut utf16 = origin.to_vec();
        utf16.push(0);
        for ch in "rest-box.studio.v1".encode_utf16() { utf16.extend_from_slice(&ch.to_le_bytes()); }
        keys.push(utf16);
        for key in keys {
            if let Some(value) = db.get_at(&snapshot, &key).ok()? {
                if value.is_empty() || value.len() > 2_000_001 { return None; }
                let bytes = value.to_vec();
                if found.as_ref().is_some_and(|old| old != &bytes) { return None; }
                found = Some(bytes);
            }
        }
    }
    Some(found.unwrap_or_default())
}

#[no_mangle]
pub extern "system" fn Java_com_elementeracoast_app_core_restbox_LegacyStudioRecovery_readCopiedLevelDb(
    mut env: JNIEnv<'_>, _class: JClass<'_>, path: JString<'_>,
) -> jbyteArray {
    let output = catch_unwind(AssertUnwindSafe(|| {
        let path: String = env.get_string(&path).ok()?.into();
        if path.len() > 4096 { return None; }
        read_legacy_studio(&path)
    })).ok().flatten();
    match output {
        Some(bytes) => env.byte_array_from_slice(&bytes).map(|a| a.into_raw()).unwrap_or(ptr::null_mut()),
        None => ptr::null_mut(),
    }
}
