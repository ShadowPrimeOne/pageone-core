#!/usr/bin/env node
/**
 * Trim transparent padding and export a 400x100 PNG logo.
 * Usage: node scripts/process-logo.mjs [inputPath] [outputPath]
 * Defaults: input: assets/logo-source.png, output: public/logo-400x100.png
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const cwd = process.cwd()
const input = process.argv[2] || path.join(cwd, 'assets', 'logo-source.png')
const output = process.argv[3] || path.join(cwd, 'public', 'logo-400x100.png')

async function main() {
  try {
    await fs.mkdir(path.dirname(output), { recursive: true })

    // Load, trim transparent edges, then fit into 400x100 canvas.
    const img = sharp(input)
      .trim({ threshold: 10 }) // increase threshold if faint halo remains
      .resize(400, 100, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // transparent
      })

    await img.png({ compressionLevel: 9 }).toFile(output)

    // Optional 2x asset
    const output2x = output.replace(/\.png$/, '@2x.png')
    await sharp(input)
      .trim({ threshold: 10 })
      .resize(800, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(output2x)

    console.log('✔ Logo exported:')
    console.log(' -', path.relative(cwd, output))
    console.log(' -', path.relative(cwd, output2x))
  } catch (err) {
    console.error('✖ Failed to process logo')
    console.error(err?.message || err)
    process.exit(1)
  }
}

main()
