//! Native static SVG rasterization. The app only sends sanitized, bundled art.
//! Default sprites still use the reference compiler; this handles edited SVGs.
use jni::{objects::{JClass, JString}, sys::{jbyteArray, jint}, JNIEnv};
use resvg::{tiny_skia, usvg};
use std::{panic::{catch_unwind, AssertUnwindSafe}, ptr, sync::{Arc, OnceLock}};

fn raster(svg: &str, w: u32, h: u32) -> Result<Vec<u8>, String> {
    if w == 0 || h == 0 || w > 1536 || h > 1536 || svg.len() > 1_000_000 {
        return Err("Native SVG dimensions or input exceed bounds".into());
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
    let tree = usvg::Tree::from_str(svg, &options).map_err(|e| format!("SVG parse: {e}"))?;
    let mut pixmap = tiny_skia::Pixmap::new(w, h).ok_or("Native pixmap allocation failed")?;
    let s = tree.size();
    let transform = tiny_skia::Transform::from_scale(w as f32 / s.width(), h as f32 / s.height());
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    if !pixmap.data().chunks_exact(4).any(|p| p[3] != 0) {
        return Err("SVG rendered fully transparent".into());
    }
    pixmap.encode_png().map_err(|e| format!("PNG encode: {e}"))
}

#[no_mangle]
pub extern "system" fn Java_com_elementeracoast_app_feature_daily_NativeSvgRaster_renderPng(
    mut env: JNIEnv<'_>, _class: JClass<'_>, svg: JString<'_>, w: jint, h: jint,
) -> jbyteArray {
    if w <= 0 || h <= 0 || w > 1536 || h > 1536 {
        return ptr::null_mut();
    }
    let output = catch_unwind(AssertUnwindSafe(|| {
        let input: String = env.get_string(&svg).map_err(|e| format!("JNI string: {e}"))?.into();
        raster(&input, w as u32, h as u32)
    }));
    match output {
        Ok(Ok(bytes)) => env.byte_array_from_slice(&bytes).map(|a| a.into_raw()).unwrap_or(ptr::null_mut()),
        Ok(Err(message)) => { let _=env.throw_new("java/lang/IllegalStateException",message); ptr::null_mut() },
        Err(_) => { let _=env.throw_new("java/lang/IllegalStateException","Native SVG rendering panic"); ptr::null_mut() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paints_and_rejects_empty_or_oversized() {
        let input = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#cc8844"/></svg>"##;
        assert!(raster(input, 20, 20).is_ok());
        assert!(raster(input, 0, 20).is_err());
        assert!(raster(input, 1537, 20).is_err());
    }

    #[test]
    fn canonical_complex_svg_renders_on_host() {
        for (label, svg) in [
            ("window", include_str!("../../../web/elementera-mcp/deploy-pages/public/rest-box/art/v1/assets/living-window.svg")),
            ("curtains", include_str!("../../../web/elementera-mcp/deploy-pages/public/rest-box/art/v1/assets/living-curtains.svg")),
        ] {
            if let Err(message) = raster(svg, 322, 302) {
                panic!("{label}: {message}");
            }
        }
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

#[cfg(test)]
mod legacy_tests {
    use super::*;
    #[test]
    fn exact_legacy_key_is_read_and_other_origin_is_ignored() {
        let dir = std::env::temp_dir().join(format!("coast-legacy-test-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut db = rusty_leveldb::DB::open(&dir, rusty_leveldb::Options::default()).unwrap();
        db.put(b"_https://unrelated.invalid\0\x01rest-box.studio.v1", b"\x01not-the-studio").unwrap();
        db.flush().unwrap();
        db.close().unwrap();
        drop(db);
        assert_eq!(read_legacy_studio(dir.to_str().unwrap()).unwrap(), b"");
        let mut db = rusty_leveldb::DB::open(&dir, rusty_leveldb::Options::default()).unwrap();
        db.put(b"_https://rest-studio.invalid\0\x01rest-box.studio.v1", b"\x01{\"version\":1}").unwrap();
        db.flush().unwrap();
        db.close().unwrap();
        drop(db);
        assert_eq!(read_legacy_studio(dir.to_str().unwrap()).unwrap(), b"\x01{\"version\":1}");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
