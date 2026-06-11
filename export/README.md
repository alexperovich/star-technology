# Star Technology Data Export Process

This document explains how to export and process data for the Star Technology Calculator.

## Prerequisites

- .NET SDK 8.0 or later
- Minecraft with the modpack installed, including the [recipe data exporter](https://github.com/alexperovich/recipe-data-exporter) mod that produces the JSON `export` directory

## Step 1: Export Data from Minecraft

> **Important:** The EMI mod must be disabled before running the export, otherwise the export will not function correctly.

1. Run the in-game exporter from the [recipe data exporter](https://github.com/alexperovich/recipe-data-exporter) mod. The exported data will be saved to `.minecraft/local/export`.
2. The export is a directory containing `items.json`, `fluids.json`, `recipeTypes.json`, the `recipes/` and `tags/` directories, and an `images/` directory of loose PNG icons.

## Step 2: Process Exported Data

1. Navigate to the export project directory
2. Run the C# project:
   ```bash
   dotnet run <path to export-data directory> [--output <path>] [--skipIcons]
   ```
   Arguments:
   - `<path to export-data directory>`: Required. Path to the directory containing the JSON export
   - `--output <path>`: Path to the data directory (if skipped, generated files will be put in the current directory)
   - `--skipIcons`: Skip building the texture atlas (useful for faster data-only runs)

3. The project will process the exported data and generate:
   - `atlas.webp`: A texture atlas containing all item icons
   - `data.bin`: A binary file containing processed recipe and item data