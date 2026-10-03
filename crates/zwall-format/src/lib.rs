

pub mod scan;

use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io::{Read, Seek, Write},
};


pub const FORMAT_VERSION: u32 = 2;
pub const MANIFEST: &str = "manifest.toml";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("zip: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("manifest: {0}")]
    Parse(#[from] toml::de::Error),
    #[error("manifest: {0}")]
    Write(#[from] toml::ser::Error),
    #[error("format version {0} is newer than this ZWall understands ({FORMAT_VERSION})")]
    TooNew(u32),
    #[error("packed asset: {0}")]
    Packed(String),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Video,
    Parallax,
    Shader,
    Web,
    Scene,
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Param {
    Number(f64),
    Bool(bool),

    Text(String),
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Packed {


    pub codec: String,

    pub file: String,

    pub size: u64,
    pub crc32: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Layer {
    pub kind: Kind,


    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub packed: Option<Packed>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, Param>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub audio_reactive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Manifest {
    pub format: u32,
    pub name: String,
    pub kind: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub licence: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,

    #[serde(default, rename = "layer")]
    pub layers: Vec<Layer>,
}

impl Manifest {
    pub fn from_toml(s: &str) -> Result<Self> {
        let m: Self = toml::from_str(s)?;
        if m.format > FORMAT_VERSION {
            return Err(Error::TooNew(m.format));
        }
        Ok(m)
    }

    pub fn to_toml(&self) -> Result<String> {
        Ok(toml::to_string_pretty(self)?)
    }
}


pub fn read_manifest<R: Read + Seek>(r: R) -> Result<Manifest> {
    let mut zip = zip::ZipArchive::new(r)?;
    let mut s = String::new();
    zip.by_name(MANIFEST)?.read_to_string(&mut s)?;
    Manifest::from_toml(&s)
}


pub fn unpack(p: &Packed, data: &[u8]) -> Result<Vec<u8>> {
    let out = match p.codec.as_str() {
        "jxl-jpeg" => {
            let image = jxl_oxide::JxlImage::builder().read(std::io::Cursor::new(data)).map_err(|e| Error::Packed(e.to_string()))?;
            let mut jpeg = Vec::with_capacity(p.size as usize);
            image.reconstruct_jpeg(&mut jpeg).map_err(|e| Error::Packed(e.to_string()))?;
            jpeg
        }
        other => return Err(Error::Packed(format!("unknown codec {other}"))),
    };
    if out.len() as u64 != p.size || crc32fast::hash(&out) != p.crc32 {
        return Err(Error::Packed("doesn't match the original (damaged file?)".into()));
    }
    Ok(out)
}


pub fn read_asset<R: Read + Seek>(zip: &mut zip::ZipArchive<R>, layer: &Layer) -> Result<Vec<u8>> {
    let name = layer.packed.as_ref().map_or(layer.source.as_str(), |p| p.file.as_str());
    let mut data = Vec::new();
    zip.by_name(name)?.read_to_end(&mut data)?;
    match &layer.packed {
        Some(p) => unpack(p, &data),
        None => Ok(data),
    }
}


pub fn write<W: Write + Seek>(w: W, manifest: &Manifest, assets: &[(&str, &[u8])]) -> Result<()> {

    let mut manifest = manifest.clone();
    if manifest.layers.iter().all(|l| l.packed.is_none()) {
        manifest.format = manifest.format.min(1);
    }
    let manifest = &manifest;
    let mut zip = zip::ZipWriter::new(w);
    let opts = zip::write::SimpleFileOptions::default();
    zip.start_file(MANIFEST, opts)?;
    zip.write_all(manifest.to_toml()?.as_bytes())?;

    let stored = opts.compression_method(zip::CompressionMethod::Stored);
    for (path, bytes) in assets {
        zip.start_file(*path, stored)?;
        zip.write_all(bytes)?;
    }
    zip.finish()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn sample() -> Manifest {
        Manifest {
            format: FORMAT_VERSION,
            name: "Kyoto rain".into(),
            kind: Kind::Scene,
            author: Some("TheHolyOneZ".into()),
            licence: Some("CC-BY-4.0".into()),
            tags: vec!["city".into(), "rain".into()],
            layers: vec![
                Layer {
                    kind: Kind::Parallax,
                    source: "assets/kyoto.jpg".into(),
                    packed: None,
                    params: BTreeMap::from([("depth".into(), Param::Number(0.6))]),
                    audio_reactive: false,
                },
                Layer {
                    kind: Kind::Shader,
                    source: "assets/rain.wgsl".into(),
                    packed: None,
                    params: BTreeMap::from([("tint".into(), Param::Text("accent".into()))]),
                    audio_reactive: true,
                },
            ],
        }
    }

    #[test]
    fn manifest_toml_round_trip() {
        let m = sample();
        assert_eq!(Manifest::from_toml(&m.to_toml().unwrap()).unwrap(), m);
    }

    #[test]
    fn zip_round_trip() {
        let mut buf = Cursor::new(Vec::new());
        write(&mut buf, &sample(), &[("assets/rain.wgsl", b"// shader")]).unwrap();
        buf.set_position(0);

        assert_eq!(read_manifest(buf).unwrap(), Manifest { format: 1, ..sample() });
    }

    #[test]
    fn packed_assets_are_checked() {
        let p = Packed { codec: "jxl-jpeg".into(), file: "assets/a.jpg.jxl".into(), size: 3, crc32: 0 };
        assert!(unpack(&p, b"not a jxl").is_err());
        let unknown = Packed { codec: "zzz".into(), ..p };
        assert!(unpack(&unknown, b"").is_err());
    }

    #[test]
    fn rejects_newer_format() {
        let s = "format = 99\nname = \"x\"\nkind = \"video\"\n";
        assert!(matches!(Manifest::from_toml(s), Err(Error::TooNew(99))));
    }
}
