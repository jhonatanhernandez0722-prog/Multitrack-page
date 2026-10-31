/**
 * Catálogo de categorías instrumentales de Gosen Tracks (fuente única: la app las usa por su id).
 *
 * Los ids son el contrato con la app de escritorio/móvil (TRACK_TYPE_IDS en src/shared/types.ts):
 * de ellos dependen la salida por defecto, qué pistas se transponen (click y guías no), las reglas de
 * sonido de la consola y el color. Si se añade una categoría aquí, hay que añadirla también allí.
 * Este archivo se generó a partir de la app (trackTypes.ts y trackNaming.ts) para no perder ninguna.
 */
export const CATEGORIES = [
  { id: "drums", label: "Batería", color: "#f46a6a" },
  { id: "percussion", label: "Percusión", color: "#f08c5a" },
  { id: "loops", label: "Loops / Secuencias", color: "#e879a6" },
  { id: "bass", label: "Bajo eléctrico", color: "#f1b44c" },
  { id: "synthbass", label: "Bajo synth", color: "#e0a33a" },
  { id: "guitar", label: "Guitarra eléctrica", color: "#8fd16a" },
  { id: "acoustic", label: "Guitarra acústica", color: "#c2d66a" },
  { id: "piano", label: "Piano", color: "#2fd8a8" },
  { id: "keys", label: "Teclados", color: "#34c38f" },
  { id: "organ", label: "Órgano", color: "#1fa97a" },
  { id: "synth", label: "Sintetizador", color: "#3ec5d6" },
  { id: "pad", label: "Pads", color: "#5fb4e8" },
  { id: "strings", label: "Cuerdas", color: "#b88cff" },
  { id: "violin", label: "Violín / Viola", color: "#c9a3ff" },
  { id: "cello", label: "Chelo / Contrabajo", color: "#a07cf0" },
  { id: "accordion", label: "Acordeón / Bandoneón", color: "#ff8fab" },
  { id: "harmonica", label: "Armónica", color: "#ffa8a8" },
  { id: "ukulele", label: "Ukelele", color: "#d8e86a" },
  { id: "mandolin", label: "Mandolina", color: "#b5d96a" },
  { id: "charango", label: "Charango / Cuatro", color: "#9fd36a" },
  { id: "trumpet", label: "Trompeta", color: "#ffcf4a" },
  { id: "trombone", label: "Trombón", color: "#ffb547" },
  { id: "sax", label: "Saxofón", color: "#ff9f43" },
  { id: "brass", label: "Metales", color: "#f7c948" },
  { id: "flute", label: "Flauta / Maderas", color: "#9be3d0" },
  { id: "vocals", label: "Voces", color: "#4f8cff" },
  { id: "choir", label: "Coros", color: "#8a7dff" },
  { id: "click", label: "Click", color: "#9aa3b5" },
  { id: "guide", label: "Guía", color: "#c77dff" },
  { id: "guide2", label: "Guía 2", color: "#e599f7" },
  { id: "other", label: "Otro", color: "#6b7385" }
]

/** Familias para agrupar el selector (mismo orden que en la app). */
export const FAMILIES = [
  { label: "Ritmo", ids: ["drums", "percussion", "loops"] },
  { label: "Bajos", ids: ["bass", "synthbass"] },
  { label: "Guitarras y cuerdas pulsadas", ids: ["guitar", "acoustic", "ukulele", "mandolin", "charango"] },
  { label: "Teclas", ids: ["piano", "keys", "organ", "synth", "pad"] },
  { label: "Cuerdas frotadas", ids: ["strings", "violin", "cello"] },
  { label: "Vientos", ids: ["trumpet", "trombone", "sax", "brass", "flute", "accordion", "harmonica"] },
  { label: "Voces", ids: ["vocals", "choir"] },
  { label: "Referencia", ids: ["click", "guide", "guide2", "other"] }
]

export const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id))

/** Formatos de audio que la app reproduce. */
export const AUDIO_EXTENSIONS = ['.wav', '.mp3']

export function isAudioFile(name) {
  const lower = name.toLowerCase()
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** Palabras clave (español/inglés) → categoría y nombre legible. El orden importa: lo más específico primero. */
const RULES = [
  { type: 'click', label: 'Click', keywords: ['click', 'clic', 'metronomo', 'metronome'] },
  { type: 'guide2', label: 'Guía 2', keywords: ['guia 2', 'guide 2', 'guia2', 'guide2', 'cues 2'] },
  { type: 'guide', label: 'Guía', keywords: ['guia', 'guide', 'cue', 'cues', 'vocal guide'] },
  { type: 'choir', label: 'Coros', keywords: ['coro', 'coros', 'choir', 'bgv', 'backing vocal', 'backings', 'harmony', 'armonia'] },
  { type: 'vocals', label: 'Voces', keywords: ['voz', 'voces', 'vocal', 'vocals', 'vox', 'lead', 'cantante'] },
  { type: 'trumpet', label: 'Trompeta', keywords: ['trompeta', 'trompetas', 'trumpet', 'trumpets', 'tpt', 'flugel', 'flugelhorn'] },
  { type: 'trombone', label: 'Trombón', keywords: ['trombon', 'trombones', 'trombone', 'tbn'] },
  { type: 'sax', label: 'Saxofón', keywords: ['sax', 'saxo', 'saxofon', 'saxophone'] },
  { type: 'flute', label: 'Flauta', keywords: ['flauta', 'flute', 'flutes', 'clarinete', 'clarinet', 'oboe', 'woodwind', 'woodwinds'] },
  { type: 'brass', label: 'Metales', keywords: ['brass', 'metales', 'horns', 'horn', 'vientos', 'tuba', 'corno'] },
  { type: 'accordion', label: 'Acordeón', keywords: ['acordeon', 'accordion', 'bandoneon', 'acordion'] },
  { type: 'harmonica', label: 'Armónica', keywords: ['armonica', 'harmonica', 'harp mouth', 'blues harp'] },
  { type: 'ukulele', label: 'Ukelele', keywords: ['ukelele', 'ukulele', 'uke'] },
  { type: 'mandolin', label: 'Mandolina', keywords: ['mandolina', 'mandolin'] },
  { type: 'charango', label: 'Charango', keywords: ['charango', 'cuatro', 'tiple', 'bandola', 'requinto'] },
  { type: 'cello', label: 'Chelo', keywords: ['cello', 'chelo', 'violonchelo', 'violoncello', 'contrabajo arco', 'double bass'] },
  { type: 'violin', label: 'Violín', keywords: ['violin', 'violines', 'violins', 'viola', 'violas', 'fiddle'] },
  { type: 'strings', label: 'Cuerdas', keywords: ['strings', 'string', 'cuerdas', 'orquesta', 'orchestra', 'ensemble'] },
  { type: 'loops', label: 'Loops / Secuencias', keywords: ['loop', 'loops', 'secuencia', 'secuencias', 'seq', 'sequence', 'fx', 'efectos'] },
  { type: 'percussion', label: 'Percusión', keywords: ['perc', 'percusion', 'percussion', 'shaker', 'tambourine', 'pandero', 'conga', 'congas', 'bongo', 'cajon', 'timbal', 'timbales'] },
  { type: 'drums', label: 'Batería', keywords: ['bateria', 'drum', 'drums', 'kick', 'snare', 'bombo', 'redoblante', 'toms', 'overhead', 'hihat', 'hat'] },
  { type: 'synthbass', label: 'Bajo synth', keywords: ['synth bass', 'synthbass', 'bajo synth', 'sub', '808', 'subbass', 'sub bass'] },
  { type: 'bass', label: 'Bajo eléctrico', keywords: ['bajo', 'bass', 'contrabajo'] },
  { type: 'acoustic', label: 'Guitarra acústica', keywords: ['acustica', 'acoustic', 'ag', 'acus', 'nylon'] },
  { type: 'guitar', label: 'Guitarra eléctrica', keywords: ['guitarra', 'guitar', 'gtr', 'eg', 'electrica', 'electric'] },
  { type: 'piano', label: 'Piano', keywords: ['piano', 'pno', 'grand', 'upright'] },
  { type: 'organ', label: 'Órgano', keywords: ['organ', 'organo', 'hammond', 'b3'] },
  { type: 'pad', label: 'Pads', keywords: ['pad', 'pads', 'ambient', 'atmos', 'atmosfera', 'colchon'] },
  { type: 'synth', label: 'Sintetizador', keywords: ['synth', 'sinte', 'sintetizador', 'arp', 'lead synth', 'moog'] },
  { type: 'keys', label: 'Teclados', keywords: ['keys', 'key', 'teclado', 'teclados', 'rhodes', 'wurli', 'ep', 'epiano'] }
]

function normalize(s) {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
}

/** "01_bateria-final" → "01 Bateria Final" (se conserva lo que escribió el usuario, solo se limpia). */
function prettify(base) {
  const cleaned = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : 'Pista'
}

/** Nombre y categoría sugeridos a partir del nombre del archivo (mismas reglas que la app). */
export function guessTrack(fileName) {
  const file = fileName.split(/[\\/]/).pop() ?? fileName
  const dot = file.lastIndexOf('.')
  const base = dot > 0 ? file.slice(0, dot) : file
  const words = normalize(base).split(/\s+/).filter(Boolean)
  const text = ` ${words.join(' ')} `
  for (const rule of RULES) {
    if (rule.keywords.some((k) => text.includes(` ${k} `) || words.some((w) => w.startsWith(k) && k.length >= 4))) {
      return { name: prettify(base), category: rule.type }
    }
  }
  return { name: prettify(base), category: 'other' }
}
