/**
 * 🖼️ Convertir imágenes a WebP — ST Perfumería
 *
 * Uso: node convertir-webp.js
 *
 * Busca JPG, JPEG, PNG en la carpeta img/ y las convierte a WebP.
 * El original se elimina después de convertir.
 * Si ya existe el .webp, lo saltea.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const IMG_DIR = path.join(__dirname, 'img');
const EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const QUALITY = 80; // Calidad WebP (80 es buen balance calidad/peso)

async function convertToWebp() {
  if (!fs.existsSync(IMG_DIR)) {
    console.log('❌ No se encontró la carpeta img/');
    return;
  }

  const files = fs.readdirSync(IMG_DIR);
  const toConvert = files.filter(function(f) {
    var ext = path.extname(f).toLowerCase();
    return EXTENSIONS.indexOf(ext) !== -1;
  });

  if (toConvert.length === 0) {
    console.log('✅ No hay imágenes para convertir. Todo ya es WebP.');
    return;
  }

  console.log('🔄 Encontradas ' + toConvert.length + ' imágenes para convertir:\n');

  var converted = 0;
  var errors = 0;

  for (var i = 0; i < toConvert.length; i++) {
    var file = toConvert[i];
    var inputPath = path.join(IMG_DIR, file);
    var baseName = path.parse(file).name;
    var outputPath = path.join(IMG_DIR, baseName + '.webp');

    // Si ya existe el webp, saltear
    if (fs.existsSync(outputPath)) {
      console.log('  ⏭️  ' + file + ' → ya existe .webp, salteado');
      continue;
    }

    try {
      var inputSize = fs.statSync(inputPath).size;
      await sharp(inputPath)
        .webp({ quality: QUALITY })
        .toFile(outputPath);

      var outputSize = fs.statSync(outputPath).size;
      var saved = Math.round((1 - outputSize / inputSize) * 100);

      // Eliminar original
      fs.unlinkSync(inputPath);

      console.log('  ✅ ' + file + ' → ' + baseName + '.webp (' + saved + '% más liviano)');
      converted++;
    } catch (e) {
      console.log('  ❌ ' + file + ' → Error: ' + e.message);
      errors++;
    }
  }

  console.log('\n📊 Resultado: ' + converted + ' convertidas, ' + errors + ' errores');

  if (converted > 0) {
    console.log('\n⚠️  Recordá actualizar perfumes.js si cambiaste nombres de archivo.');
  }
}

convertToWebp();
