const fs = require('fs');
const path = require('path');
const UglifyJS = require('uglify-js');
const CleanCSS = require('clean-css');

// Create docs directory if it doesn't exist
const distDir = path.join(__dirname, 'docs');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

// Function to minify JS files
function minifyJS(inputFile, outputFile) {
  try {
    const code = fs.readFileSync(inputFile, 'utf8');
    const result = UglifyJS.minify(code);

    if (result.error) {
      console.error(`Error minifying ${inputFile}:`, result.error);
      return false;
    }

    fs.writeFileSync(outputFile, result.code, 'utf8');
    console.log(`✓ Minified: ${inputFile} → ${outputFile}`);
    return true;
  } catch (error) {
    console.error(`Error processing ${inputFile}:`, error.message);
    return false;
  }
}

// Function to minify CSS files
function minifyCSS(inputFile, outputFile) {
  try {
    const code = fs.readFileSync(inputFile, 'utf8');
    const result = new CleanCSS().minify(code);

    if (result.errors.length > 0) {
      console.error(`Error minifying ${inputFile}:`, result.errors);
      return false;
    }

    fs.writeFileSync(outputFile, result.styles, 'utf8');
    console.log(`✓ Minified: ${inputFile} → ${outputFile}`);
    return true;
  } catch (error) {
    console.error(`Error processing ${inputFile}:`, error.message);
    return false;
  }
}

function minifyHTML(inputFile, outputFile, options) {
  try {
    var html = fs.readFileSync(inputFile, 'utf8');
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    html = html.replace(/\s+/g, ' ');
    html = html.replace(/>\s+</g, '><');
    html = html.trim();

    if (options && options.stripDocsPrefix) {
      html = html.replace(/docs\/style\.min\.css/g, 'style.min.css');
      html = html.replace(/docs\/app\.min\.js/g, 'app.min.js');
    }
    fs.writeFileSync(outputFile, html, 'utf8');
    console.log(`✓ Minified: ${inputFile} → ${outputFile}`);
    return true;
  } catch (error) {
    console.error(`Error processing ${inputFile}:`, error.message);
    return false;
  }
}

// Concatenate and minify JS files
console.log('Building...\n');

const jsFilesToConcat = [
  'vendor/d3.v4.js',
  'vendor/d3-scale-chromatic.v1.min.js',
  'vendor/topojson.v2.min.js',
  'assets/d3-legend.min.js',
  'assets/cloud-api.js',
  'assets/topogram.js',
  'assets/main.js'
];

const cssFiles = [
  { input: 'assets/style.css', output: 'docs/style.min.css' }
];

let allSuccess = true;

// Concatenate JS files and minify
try {
  let combinedCode = jsFilesToConcat
    .map(file => {
      const code = fs.readFileSync(file, 'utf8');
      return `/* ${file} */\n${code}`;
    })
    .join('\n\n');

  const result = UglifyJS.minify(combinedCode);

  if (result.error) {
    console.error('Error minifying JS files:', result.error);
    allSuccess = false;
  } else {
    fs.writeFileSync('docs/app.min.js', result.code, 'utf8');
    console.log(`✓ Concatenated and minified: ${jsFilesToConcat.join(', ')} → docs/app.min.js`);
  }
} catch (error) {
  console.error('Error processing JS files:', error.message);
  allSuccess = false;
}

// Process CSS files
cssFiles.forEach(file => {
  const success = minifyCSS(file.input, file.output);
  allSuccess = allSuccess && success;
});

const htmlSuccess = minifyHTML('index.html', 'docs/index.html', { stripDocsPrefix: true });
allSuccess = allSuccess && htmlSuccess;

try {
  const dataSrc = path.join(__dirname, 'data');
  const dataDest = path.join(distDir, 'data');
  if (fs.existsSync(dataDest)) {
    fs.rmSync(dataDest, { recursive: true, force: true });
  }
  fs.cpSync(dataSrc, dataDest, { recursive: true });
  console.log(`✓ Copied: data → docs/data`);
} catch (error) {
  console.warn('⚠️  data copy skipped:', error.message);
}

try {
  const vendorSrc = path.join(__dirname, 'vendor');
  const vendorDest = path.join(distDir, 'vendor');
  if (fs.existsSync(vendorDest)) {
    fs.rmSync(vendorDest, { recursive: true, force: true });
  }
  fs.cpSync(vendorSrc, vendorDest, { recursive: true });
  console.log(`✓ Copied: vendor → docs/vendor`);
} catch (error) {
  console.warn('⚠️  vendor copy skipped:', error.message);
}

try {
  const cnameSrc = path.join(__dirname, 'CNAME');
  const cnameDest = path.join(distDir, 'CNAME');
  if (fs.existsSync(cnameSrc)) {
    fs.copyFileSync(cnameSrc, cnameDest);
    console.log(`✓ Copied: CNAME → docs/CNAME`);
  }
} catch (error) {
  console.warn('⚠️  CNAME copy skipped:', error.message);
}

console.log('');
if (allSuccess) {
  console.log('✓ Build completed successfully!');
  process.exit(0);
} else {
  console.log('✗ Build completed with errors.');
  process.exit(1);
}
