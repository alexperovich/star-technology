using export;
using Source.Data;

namespace Source
{
    public static class PackGenerator
    {
        public static Repository Generate(string sourcePath, string targetPath, bool skipIcons = false, string previousDataBin = null)
        {
            var iconList = new List<string>();
            var repository = ExportDataConverter.Convert(sourcePath, iconList);
            
            PackPreProcessor.PreProcessPack(repository);
            FontCharactersFixer.FixFontCharacters(repository);
            RecipeConflictsCalculator.CalculateRecipeConflicts(repository);
            
            if (previousDataBin != null)
            {
                OldRecipesGenerator.PopulateOldRecipes(repository, previousDataBin);
            }
            
            Console.WriteLine("Exporting data.bin...");
            var mmap = new MemoryMappedPackConverter(repository);
            var compiledBytes = mmap.Compile();
            File.WriteAllBytes(Path.Combine(targetPath, "data.bin"), compiledBytes);
            
            if (!skipIcons)
            {
                using var builder = new AtlasBuilder(sourcePath, Path.Combine(targetPath, "atlas.webp"));
                builder.BuildAtlas(iconList);
            }
            
            return repository;
        }
    }
}