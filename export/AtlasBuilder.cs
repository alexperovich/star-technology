using System;
using System.Collections.Generic;
using System.IO;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;
using SixLabors.ImageSharp.Formats.Webp;

namespace Source
{
    public class AtlasBuilder : IDisposable
    {
        private readonly string baseDir;
        private readonly string savePath;
        
        public AtlasBuilder(string baseDir, string savePath)
        {
            this.baseDir = baseDir;
            this.savePath = savePath;
        }

        private Image<Rgba32> LoadImage(string path)
        {
            if (string.IsNullOrEmpty(path))
                return null;
            var fullPath = Path.Combine(baseDir, path);
            if (!File.Exists(fullPath))
            {
                Console.WriteLine("Unable to find image file " + fullPath);
                return null;
            }

            return Image.Load<Rgba32>(fullPath);
        }
        
        public string BuildAtlas(List<string> iconsPaths)
        {
            Console.WriteLine($"Starting atlas creation with {iconsPaths.Count} icons...");
            
            // Calculate required dimensions first
            var iconsCount = iconsPaths.Count;
            var requiredHeight = (iconsCount - 1) / (1 << IconAtlas.DimensionBits) + 1;
            var width = (1 << IconAtlas.DimensionBits) * IconAtlas.ImageSize;
            var height = requiredHeight * IconAtlas.ImageSize;

            Console.WriteLine($"Creating atlas with dimensions {width}x{height}...");

            // Create the atlas
            using var atlas = new Image<Rgba32>(width, height);
            
            // Draw all images onto the atlas
            for (var i = 0; i < iconsPaths.Count; i++)
            {
                var path = iconsPaths[i];
                if (path == null) continue;
                
                if (i % 1000 == 0)
                {
                    Console.WriteLine($"Processing icon {i + 1} of {iconsPaths.Count}...");
                }
                
                var image = LoadImage(path);
                if (image == null) continue;
                
                using (image)
                {
                    var positionX = (i & IconAtlas.XMask) * IconAtlas.ImageSize;
                    var positionY = ((i & IconAtlas.YMask) >> IconAtlas.DimensionBits) * IconAtlas.ImageSize;
                    
                    atlas.Mutate(x => x.DrawImage(image, new Point(positionX, positionY), 1f));
                }
            }

            Console.WriteLine("Resizing...");

            // Resize to 50% and save as WebP
            using var resized = atlas.Clone(x => x.Resize(width / 2, height / 2, KnownResamplers.Box));
            
            Console.WriteLine("Saving as WEBP (This might take a while)...");
            var encoder = new WebpEncoder
            {
                FileFormat = WebpFileFormatType.Lossless,
                NearLossless = true,
                NearLosslessQuality = 60,
                SkipMetadata = true,
            };
            
            using var fileStream = File.Create(savePath);
            resized.Save(fileStream, encoder);

            Console.WriteLine($"Atlas creation complete. Saved to: {savePath}");
            return savePath;
        }

        public void Dispose()
        {
        }
    }
}