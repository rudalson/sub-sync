//! Installed fonts for the subtitle style: system and per-user fonts, grouped into families
//! with the weights each one really has, so the preview and the burned-in export use one face.
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
};
use ttf_parser::{name_id, Language};

/// One face of a family, named the way both renderers can find exactly it: the WebView through
/// CSS `local()` and libass through the ASS style's font name.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontWeight {
    pub weight: u16,
    pub postscript: String,
    pub full_name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    /// The English family name, kept in settings.
    pub family: String,
    /// The Korean name when the font has one, for display ("맑은 고딕").
    pub local_name: Option<String>,
    pub hangul: bool,
    pub weights: Vec<FontWeight>,
}

/// Facts read from one upright face.
#[derive(Clone, Debug)]
pub struct Face {
    pub family: String,
    pub local_name: Option<String>,
    pub legacy_family: String,
    pub subfamily: String,
    pub postscript: String,
    pub full_name: String,
    /// The OS/2 weight class, which some fonts get wrong.
    pub weight: u16,
    pub hangul: bool,
    pub path: PathBuf,
}

impl Face {
    /// The style words ("SemiBold", "6 SemiBold", "Semilight Regular") decide the weight when
    /// they name one: several installed families give every face the same OS/2 weight class.
    pub fn named_weight(&self) -> u16 {
        let style = self
            .legacy_family
            .strip_prefix(&self.family)
            .unwrap_or(&self.legacy_family)
            .to_string()
            + " "
            + &self.subfamily;
        let style: String = style
            .to_lowercase()
            .chars()
            .filter(|c| c.is_ascii_alphabetic())
            .collect();
        const NAMES: [(&str, u16); 19] = [
            ("extralight", 200),
            ("ultralight", 200),
            ("semilight", 350),
            ("demilight", 350),
            ("extrabold", 800),
            ("ultrabold", 800),
            ("semibold", 600),
            ("demibold", 600),
            ("hairline", 100),
            ("thin", 100),
            ("light", 300),
            ("medium", 500),
            ("heavy", 900),
            ("black", 900),
            ("bold", 700),
            ("regular", 400),
            ("normal", 400),
            ("book", 400),
            ("roman", 400),
        ];
        NAMES
            .iter()
            .find(|(name, _)| style.contains(name))
            .map(|(_, weight)| *weight)
            .unwrap_or(self.weight)
    }
}

#[derive(Default)]
pub struct FontCatalog {
    pub families: Vec<FontFamily>,
    files: HashMap<String, Vec<PathBuf>>,
}

impl FontCatalog {
    pub fn load() -> Self {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let faces = db
            .faces()
            .filter(|info| info.style == fontdb::Style::Normal)
            .filter_map(|info| {
                let fontdb::Source::File(path) = &info.source else {
                    return None;
                };
                let (path, postscript, weight) =
                    (path.clone(), info.post_script_name.clone(), info.weight.0);
                db.with_face_data(info.id, |data, index| {
                    read_face(data, index, weight, postscript, path)
                })
                .flatten()
            })
            .collect();
        Self::from_faces(faces)
    }

    pub fn from_faces(faces: Vec<Face>) -> Self {
        let mut grouped: BTreeMap<String, Vec<Face>> = BTreeMap::new();
        for face in faces {
            // Vertical-writing aliases ("@Malgun Gothic") and nameless faces are not choices.
            if face.family.is_empty() || face.family.starts_with('@') || face.postscript.is_empty()
            {
                continue;
            }
            grouped
                .entry(face.family.to_lowercase())
                .or_default()
                .push(face);
        }
        let mut families = Vec::new();
        let mut files = HashMap::new();
        for (key, faces) in grouped {
            let mut weights: Vec<FontWeight> = Vec::new();
            let mut paths: Vec<PathBuf> = Vec::new();
            for face in &faces {
                if !paths.contains(&face.path) {
                    paths.push(face.path.clone());
                }
                let weight = face.named_weight();
                // A family shipped as both static files and a variable font: the first face wins.
                if !weights.iter().any(|known| known.weight == weight) {
                    weights.push(FontWeight {
                        weight,
                        postscript: face.postscript.clone(),
                        full_name: face.full_name.clone(),
                    });
                }
            }
            weights.sort_by_key(|weight| weight.weight);
            families.push(FontFamily {
                family: faces[0].family.clone(),
                local_name: faces.iter().find_map(|face| face.local_name.clone()),
                hangul: faces.iter().any(|face| face.hangul),
                weights,
            });
            files.insert(key, paths);
        }
        families.sort_by_key(|family| display_name(family).to_lowercase());
        Self { families, files }
    }

    /// The font files of one family, only ever from the scanned font folders.
    pub fn files(&self, family: &str) -> &[PathBuf] {
        self.files
            .get(&family.to_lowercase())
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
}

fn display_name(family: &FontFamily) -> &str {
    family.local_name.as_deref().unwrap_or(&family.family)
}

fn read_face(
    data: &[u8],
    index: u32,
    weight: u16,
    postscript: String,
    path: PathBuf,
) -> Option<Face> {
    let face = ttf_parser::Face::parse(data, index).ok()?;
    let name = |id: u16, language: Language| {
        face.names()
            .into_iter()
            .filter(|name| name.name_id == id && name.language() == language)
            .find_map(|name| name.to_string())
            .filter(|value| !value.trim().is_empty())
    };
    let english = |id: u16| name(id, Language::English_UnitedStates);
    let legacy_family = english(name_id::FAMILY)?;
    let family = english(name_id::TYPOGRAPHIC_FAMILY).unwrap_or_else(|| legacy_family.clone());
    let local_name = name(name_id::TYPOGRAPHIC_FAMILY, Language::Korean_Korea)
        .or_else(|| name(name_id::FAMILY, Language::Korean_Korea))
        .filter(|local| local != &family);
    Some(Face {
        full_name: english(name_id::FULL_NAME).unwrap_or_else(|| postscript.clone()),
        family,
        local_name,
        legacy_family,
        subfamily: english(name_id::SUBFAMILY).unwrap_or_default(),
        postscript,
        weight,
        hangul: face.glyph_index('가').is_some() && face.glyph_index('힣').is_some(),
        path,
    })
}

/// Copies a family's files into `folder` for ffmpeg's `fontsdir`, so the export finds fonts
/// installed for the current user too, which the bundled fontconfig does not scan.
pub fn copy_family(catalog: &FontCatalog, family: &str, folder: &Path) -> Result<usize, String> {
    let files = catalog.files(family);
    for (index, file) in files.iter().enumerate() {
        let extension = file
            .extension()
            .map(|extension| extension.to_string_lossy().to_lowercase())
            .unwrap_or_else(|| "ttf".into());
        // ASCII names: libass opens fontsdir files through the C runtime, which cannot read a
        // Korean file name such as "삼성긴고딕 Bold.ttf" on Windows.
        std::fs::copy(file, folder.join(format!("font-{index}.{extension}")))
            .map_err(|e| e.to_string())?;
    }
    Ok(files.len())
}
