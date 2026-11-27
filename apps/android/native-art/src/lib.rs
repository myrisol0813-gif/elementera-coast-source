//! Native static SVG rasterization. The app only sends sanitized, bundled art.
//! Default sprites still use the reference compiler; this handles edited SVGs.
use jni::{objects::{JClass, JString}, sys::{jbyteArray, jint}, JNIEnv};
use resvg::{tiny_skia, usvg};
use std::{panic::{catch_unwind, AssertUnwindSafe}, ptr};

fn raster(svg: &str, w: u32, h: u32) -> Option<Vec<u8>> {
    if w == 0 || h == 0 || w > 1536 || h > 1536 || svg.len() > 1_000_000 {
        return None;
    }
    let mut options = usvg::Options::default();
    // Only the OS's installed fonts, never font files or external URLs from the SVG.
    for path in ["/system/fonts/Roboto-Regular.ttf", "/system/fonts/NotoSans-Regular.ttf", "/system/fonts/NotoSansCJK-Regular.ttc"] {
        if let Ok(data) = std::fs::read(path) { options.fontdb_mut().load_font_data(data); }
    }
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
