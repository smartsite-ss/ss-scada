// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Knowledge-base export script
 *
 * Generates kb-data.json from script-api-registry.ts and *.examples.ts
 * Also scans the plugins/ directory to extract graphic property Schema
 * Usage: node scripts/export-kb.js [outputPath]
 *
 * Examples:
 *   node scripts/export-kb.js
 *   node scripts/export-kb.js ./dist/kb-data.json
 *   node scripts/export-kb.js ./public/knowledge-base/v2/kb-data.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

const DEFAULT_OUTPUT = path.resolve(
  __dirname,
  "../packages/editor/public/knowledge-base/v2/kb-data.json",
);
const REGISTRY_PATH = path.resolve(
  __dirname,
  "../packages/editor/src/components/script/rules/script-api-registry.ts",
);
const EXAMPLES_DIR = path.resolve(
  __dirname,
  "../packages/editor/src/components/script/rules/examples",
);
const PLUGINS_DIR = path.resolve(__dirname, "../packages/plugins");

// ═══════════════════════════════════════════════════════════════
// Extra output path (apps/web/public/static/ — Vite dev server root)
// ═══════════════════════════════════════════════════════════════

const WEB_PUBLIC_STATIC_DIR = path.resolve(
  __dirname,
  "../apps/web/public/static/knowledge-base",
);

/**
 * Write kb-data.json to the specified version directory + the latest directory
 */
function writeToVersion(outputDir, kbData) {
  const versionPath = path.join(outputDir, "v2", "kb-data.json");
  writeJson(versionPath, kbData);
  const latestPath = path.join(outputDir, "latest", "kb-data.json");
  writeJson(latestPath, kbData);
}

// ═══════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════

/** Read file content */
function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf-8");
}

/** Ensure the directory exists */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/** Write JSON file */
function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`✓ Written: ${filePath}`);
}

/** Recursively find files */
function findFiles(dir, pattern) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, pattern));
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// Parse the registry
// ═══════════════════════════════════════════════════════════════

/**
 * Parse the API_REGISTRY array from a TypeScript file
 * Uses regex extraction; does not depend on the TypeScript compiler
 */
function parseApiRegistry(tsContent) {
  const registry = [];

  // Extract the API_REGISTRY array content
  const arrayMatch = tsContent.match(
    /export\s+const\s+API_REGISTRY\s*:\s*ApiMethodDef\[\]\s*=\s*\[([\s\S]*?)\];/,
  );
  if (!arrayMatch) {
    throw new Error(
      "Could not find API_REGISTRY array in script-api-registry.ts",
    );
  }

  const arrayContent = arrayMatch[1];

  // Extract each API object (simplified parsing: split by { ... } blocks)
  const objectRegex = /\{\s*name:\s*['"]([^'"]+)['"]\s*,[\s\S]*?\},?\n/g;
  let match;

  while ((match = objectRegex.exec(arrayContent)) !== null) {
    const block = match[0];

    const api = {
      name: extractString(block, "name"),
      category: extractString(block, "category"),
      signature: extractString(block, "signature"),
      summary: extractString(block, "summary"),
      description: extractString(block, "description"),
      params: extractParams(block),
      returns: extractString(block, "returns"),
      availableIn: extractArray(block, "availableIn"),
      notes: extractOptionalString(block, "notes"),
      example: extractOptionalString(block, "example"),
      detail: extractString(block, "detail"),
      insertText: extractString(block, "insertText"),
      sortText: extractString(block, "sortText"),
    };

    registry.push(api);
  }

  return registry;
}

/** Extract a string field */
function extractString(block, field) {
  const regex = new RegExp(`${field}:\\s*['"]([^'"]*)['"]`, "i");
  const match = block.match(regex);
  return match ? match[1] : "";
}

/** Extract an optional string field */
function extractOptionalString(block, field) {
  const regex = new RegExp(`${field}:\\s*['"]([^'"]*)['"]`, "i");
  const match = block.match(regex);
  return match ? match[1] : undefined;
}

/** Extract an array field */
function extractArray(block, field) {
  const regex = new RegExp(`${field}:\\s*\\[([^\\]]*)\\]`, "i");
  const match = block.match(regex);
  if (!match) return [];

  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/['"]/g, ""))
    .filter((s) => s.length > 0);
}

/** Extract the parameter array */
function extractParams(block) {
  const params = [];
  const paramsRegex = /params:\s*\[([\s\S]*?)\],\s*\n/;
  const match = block.match(paramsRegex);

  if (!match) return params;

  const paramsContent = match[1];
  const paramRegex =
    /\{\s*name:\s*['"]([^'"]+)['"]\s*,\s*type:\s*['"]([^'"]+)['"]\s*,\s*required:\s*(true|false)\s*,\s*description:\s*['"]([^'"]*)['"](?:\s*,\s*defaultValue:\s*['"]([^'"]*)['"])?\s*\}/g;

  let paramMatch;
  while ((paramMatch = paramRegex.exec(paramsContent)) !== null) {
    params.push({
      name: paramMatch[1],
      type: paramMatch[2],
      required: paramMatch[3] === "true",
      description: paramMatch[4],
      defaultValue: paramMatch[5] || undefined,
    });
  }

  return params;
}

// ═══════════════════════════════════════════════════════════════
// Parse examples
// ═══════════════════════════════════════════════════════════════

/**
 * Parse the ScriptExample array from example files
 */
function parseExamples(tsContent) {
  const examples = [];

  // Extract export const xxxExamples: ScriptExample[] = [...]
  const arrayMatch = tsContent.match(
    /export\s+const\s+\w+Examples\s*:\s*ScriptExample\[\]\s*=\s*\[([\s\S]*?)\];/,
  );
  if (!arrayMatch) return examples;

  const arrayContent = arrayMatch[1];

  // Use the bracket-counting parser to extract each example object (replaces regex; correctly handles nested { } inside code template literals)
  const objects = parseBraceBlocks(arrayContent);
  for (const block of objects) {
    const example = {
      id: extractString(block, "id"),
      title: extractString(block, "title"),
      description: extractString(block, "description"),
      category: extractString(block, "category"),
      triggerType: extractString(block, "triggerType"),
      requiredTags: extractArray(block, "requiredTags"),
      tags: extractArray(block, "tags"),
      difficulty: extractString(block, "difficulty"),
      code: extractCode(block),
    };
    if (example.id) {
      examples.push(example);
    }
  }

  return examples;
}

/**
 * Bracket-counting parser: extract all top-level { ... } blocks from text
 * Correctly handles:
 *  - nested {} (via depth counting)
 *  - template literals `` (skipping {} inside)
 *  - single/double-quoted strings (skipping {} inside)
 */
function parseBraceBlocks(text) {
  const blocks = [];
  let i = 0;
  while (i < text.length) {
    // Find the next top-level { start position
    const start = text.indexOf("{", i);
    if (start === -1) break;

    const block = extractBraceBlock(text, start);
    if (block) {
      blocks.push(block);
      i = start + block.length;
    } else {
      i = start + 1;
    }
  }
  return blocks;
}

/**
 * Extract one complete { ... } block from the given position
 * Returns the string including the outer {}
 */
function extractBraceBlock(text, startPos) {
  if (text[startPos] !== "{") return null;

  let depth = 0;
  let i = startPos;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;

  while (i < text.length) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : "";

    // Handle escape characters
    if (prev === "\\") {
      i++;
      continue;
    }

    // Handle quote state (when not inside template literals)
    if (!inTemplate) {
      if (ch === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; i++; continue; }
      if (ch === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; i++; continue; }
    }

    // Handle template literals (backticks)
    if (ch === "`" && !inSingleQuote && !inDoubleQuote) {
      inTemplate = !inTemplate;
      i++;
      continue;
    }

    // Count braces only outside strings and template literals
    if (!inSingleQuote && !inDoubleQuote && !inTemplate) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }

    i++;

    // depth back to 0 means top-level braces closed
    if (!inSingleQuote && !inDoubleQuote && !inTemplate && depth === 0) {
      return text.slice(startPos, i);
    }
  }

  return null;
}

/** Extract code blocks (supports template literals) */
function extractCode(block) {
  // Try matching template literals first
  const tplMatch = block.match(/code:\s*`([\s\S]*?)`\s*,?\s*\}/);
  if (tplMatch) {
    return tplMatch[1].trim();
  }

  const stringMatch = block.match(/code:\s*['"]([\s\S]*?)['"],?\s*\}/);
  if (stringMatch) {
    return stringMatch[1];
  }

  return "";
}

// ═══════════════════════════════════════════════════════════════
// Parse the graphic property Schema
// ═══════════════════════════════════════════════════════════════

/**
 * Parse graphic property definitions from propertySchema.ts
 */
function parseGraphicSchema(filePath) {
  try {
    const content = readFile(filePath);

    // Extract the schema name
    const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/);
    if (!nameMatch) return null;

    const displayName = nameMatch[1];

    // Extract pluginType (inferred from the file path)
    const dirParts = path.dirname(filePath).split(path.sep);
    const pluginType = dirParts[dirParts.length - 1];

    // Extract category
    const categoryParts = dirParts;
    let category = "other";
    const pluginsIdx = categoryParts.indexOf("plugins");
    if (pluginsIdx >= 0 && categoryParts.length > pluginsIdx + 2) {
      category = categoryParts[pluginsIdx + 1]; // industrial, electric, basic, etc.
    }

    // Extract the fields array
    const fieldsMatch = content.match(/fields:\s*\[([\s\S]*?)\]\s*,?\s*\}/);
    if (!fieldsMatch) return null;

    const fieldsContent = fieldsMatch[1];
    const fields = [];

    // Extract each field
    const fieldRegex =
      /\{\s*name:\s*['"]([^'"]+)['"]\s*,\s*label:\s*['"]([^'"]+)['"]\s*,[\s\S]*?\}/g;
    let fieldMatch;

    while ((fieldMatch = fieldRegex.exec(fieldsContent)) !== null) {
      const fieldBlock = fieldMatch[0];

      const field = {
        name: extractString(fieldBlock, "name"),
        type: extractString(fieldBlock, "type") || "string",
        label: extractString(fieldBlock, "label"),
        defaultValue: extractFieldDefaultValue(fieldBlock),
        options: extractFieldOptions(fieldBlock),
        min: extractFieldNumber(fieldBlock, "min"),
        max: extractFieldNumber(fieldBlock, "max"),
        step: extractFieldNumber(fieldBlock, "step"),
        group: extractString(fieldBlock, "group"),
      };

      // Skip empty name
      if (field.name) {
        fields.push(field);
      }
    }

    if (fields.length === 0) return null;

    return {
      pluginType,
      displayName,
      category,
      fields,
      schemaVersion: "1.0",
    };
  } catch {
    return null;
  }
}

/** Extract a field's default value */
function extractFieldDefaultValue(block) {
  const regex = /defaultValue:\s*([^,\s}]+)/;
  const match = block.match(regex);
  if (!match) return undefined;

  const val = match[1];
  // Strip quotes
  if (val.startsWith("'") || val.startsWith('"')) {
    return val.slice(1, -1);
  }
  // Convert boolean
  if (val === "true") return true;
  if (val === "false") return false;
  // Convert number
  const num = Number(val);
  if (!isNaN(num)) return num;
  return val;
}

/** Extract a field's numeric property */
function extractFieldNumber(block, field) {
  const regex = new RegExp(`${field}:\\s*(-?[\\d.]+)`, "i");
  const match = block.match(regex);
  return match ? Number(match[1]) : undefined;
}

/** Extract options of a select field */
function extractFieldOptions(block) {
  const optionsMatch = block.match(/options:\s*\[([\s\S]*?)\]\s*,/);
  if (!optionsMatch) return undefined;

  const optionsContent = optionsMatch[1];
  const options = [];
  const optionRegex =
    /\{\s*value:\s*['"]([^'"]+)['"]\s*,\s*label:\s*['"]([^'"]+)['"]/g;
  let optMatch;

  while ((optMatch = optionRegex.exec(optionsContent)) !== null) {
    options.push({
      value: optMatch[1],
      label: optMatch[2],
    });
  }

  return options.length > 0 ? options : undefined;
}

// ═══════════════════════════════════════════════════════════════
// Main flow
// ═══════════════════════════════════════════════════════════════

function main() {
  const outputPath = process.argv[2] || DEFAULT_OUTPUT;

  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
  console.log("  Knowledge Base Export Script (v2.3)");
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
  console.log();

  try {
    // 1. Parse the API registry
    console.log("📖 Parsing API registry...");
    const registryContent = readFile(REGISTRY_PATH);
    const apiRegistry = parseApiRegistry(registryContent);
    console.log(`   ✓ Found ${apiRegistry.length} APIs`);

    // 2. Parse the example file
    console.log("📖 Parsing examples...");
    const exampleFiles = fs
      .readdirSync(EXAMPLES_DIR)
      .filter((f) => f.endsWith(".examples.ts"))
      .map((f) => path.join(EXAMPLES_DIR, f));

    const exampleCategories = [];
    const categoryLabels = {
      "data-driven": "数据驱动",
      "event-driven": "事件驱动",
      "graphic-operation": "图元操作",
      "multi-tag-linking": "多标签联动",
      "alarm-management": "告警管理",
      "scheduled-task": "定时任务",
    };
    const categoryIcons = {
      "data-driven": "📊",
      "event-driven": "⚡",
      "graphic-operation": "🎨",
      "multi-tag-linking": "🔗",
      "alarm-management": "🔔",
      "scheduled-task": "⏱",
    };

    for (const filePath of exampleFiles) {
      const content = readFile(filePath);
      const examples = parseExamples(content);

      if (examples.length > 0) {
        const category = examples[0].category;
        exampleCategories.push({
          category,
          label: categoryLabels[category] || category,
          icon: categoryIcons[category] || "📄",
          items: examples,
        });
        console.log(`   ✓ ${category}: ${examples.length} examples`);
      }
    }

    // 3. Parse the graphic property Schema
    console.log("📖 Parsing graphic schemas...");
    const schemaFiles = findFiles(PLUGINS_DIR, /PropertySchema\.ts$/);
    const graphicSchemas = [];

    for (const filePath of schemaFiles) {
      const schema = parseGraphicSchema(filePath);
      if (schema) {
        graphicSchemas.push(schema);
      }
    }

    // Deduplicate (by pluginType)
    const seenTypes = new Set();
    const uniqueSchemas = graphicSchemas.filter((s) => {
      if (seenTypes.has(s.pluginType)) return false;
      seenTypes.add(s.pluginType);
      return true;
    });

    console.log(`   ✓ Found ${uniqueSchemas.length} graphic schemas`);
    for (const s of uniqueSchemas) {
      console.log(
        `     - ${s.pluginType} (${s.displayName}): ${s.fields.length} fields`,
      );
    }

    // 4. Build the knowledge-base JSON
    console.log();
    console.log("🔨 Building knowledge base JSON...");

    const kbData = {
      meta: {
        version: "2.3",
        appVersion: ">=1.0.0",
        updatedAt: new Date().toISOString(),
        apiCount: apiRegistry.length,
        apiNames: apiRegistry.map((a) => a.name),
        graphicSchemaCount: uniqueSchemas.length,
      },
      apiRegistry,
      examples: exampleCategories,
      graphicSchemas: uniqueSchemas,
    };

    // 5. Write to file
    console.log();
    console.log("💾 Writing output...");

    // Output to packages/editor/public/knowledge-base/ (editor package)
    writeJson(outputPath, kbData);

    // Output to apps/web/public/static/knowledge-base/ (web app — Vite dev server static dir)
    writeToVersion(WEB_PUBLIC_STATIC_DIR, kbData);

    // 6. Also write to latest (based on the editor's output directory)
    const latestPath = path.resolve(
      path.dirname(outputPath),
      "../latest/kb-data.json",
    );
    writeJson(latestPath, kbData);

    // 7. Generate versions.json
    const versionsPath = path.resolve(
      path.dirname(outputPath),
      "../versions.json",
    );
    const versionsData = {
      latest: "2.3",
      versions: [
        {
          version: "2.3",
          path: "/v2/kb-data.json",
          updatedAt: new Date().toISOString(),
          appVersionRange: ">=1.0.0",
          changes: [
            "新增图元属性 Schema 支持（graphicSchemas）",
            `共 ${uniqueSchemas.length} 种图元类型，${uniqueSchemas.reduce((sum, s) => sum + s.fields.length, 0)} 个属性字段`,
            "export-kb 脚本增强：自动扫描 plugins/ 目录提取图元属性",
            "修复 system 包知识库桩实现",
          ],
        },
      ],
    };
    writeJson(versionsPath, versionsData);

    // Also write to the web app's versions.json
    const webVersionsPath = path.join(WEB_PUBLIC_STATIC_DIR, "versions.json");
    writeJson(webVersionsPath, versionsData);

    console.log();
    console.log(
      "═══════════════════════════════════════════════════════════════",
    );
    console.log("  ✅ Export complete!");
    console.log(`  📦 APIs: ${apiRegistry.length}`);
    console.log(
      `  📦 Examples: ${exampleCategories.reduce((sum, cat) => sum + cat.items.length, 0)}`,
    );
    console.log(`  📦 Graphic Schemas: ${uniqueSchemas.length} types`);
    console.log(`  📁 Output: ${outputPath}`);
    console.log(
      "═══════════════════════════════════════════════════════════════",
    );
  } catch (err) {
    console.error();
    console.error("❌ Export failed:");
    console.error(err.message);
    console.error();
    process.exit(1);
  }
}

main();
