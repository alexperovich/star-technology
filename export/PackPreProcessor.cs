using System.Text;
using System.Text.RegularExpressions;
using export;
using Source.Data;

namespace Source
{
    public static class PackPreProcessor
    {
        public static void PreProcessPack(Repository repository)
        {
            Console.WriteLine("Adding fluid tooltips...");
            ProcessFluidTooltips(repository);
            Console.WriteLine("Processing tooltips...");
            ProcessToolTips(repository.items);
            ProcessToolTips(repository.fluids);
            Console.WriteLine("Calculating index bits");
            CalculateIndexBits(repository);
            Console.WriteLine("Calculating production/consumption");
            CalculateProductionConsumption(repository);
            Console.WriteLine("Calculating containers");
            CalculateContainers(repository);
            Console.WriteLine("Calculating machines");
            CalculateMachines(repository);
            Truncate(repository);
        }

        private static void ProcessFluidTooltips(Repository repository)
        {
            foreach (var item in repository.items)
            {
                if (item.container != null && item.container.empty.name == "Empty Cell" && !string.IsNullOrEmpty(item.tooltip))
                    item.container.fluid.tooltip = item.tooltip;
            }
        }

        private static void CalculateContainers(Repository repository)
        {
            for (var itemIndex = 0; itemIndex < repository.items.Count; itemIndex++)
            {
                var item = repository.items[itemIndex];
                if (item.container != null)
                {
                    AddToArrayBuffer(ref item.container.fluid.containers, itemIndex);
                }
            }
        }

        private static bool GetSingleBlockVoltageTier(Item item, out int tier)
        {
            tier = 0;
            if (!item.tooltip.Contains("Voltage IN"))
                return false;
            
            var cleanedTooltip = Regex.Replace(item.tooltip, "§.", "");
            
            foreach (var vtier in VoltageTiers.voltageTiers)
            {
                if (cleanedTooltip.Contains("(" + vtier + ")"))
                    return true;
                tier++;
            }
            return false;
        }
        

        private static void CalculateMachines(Repository repository)
        {
            foreach (var type in repository.recipeTypes)
            {
                var item = new List<Item>();
                foreach (var crafter in type.crafters)
                {
                    if (!item.Contains(crafter))
                    {
                        if (!crafter.tooltip.Contains("DEPRECATED"))
                            item.Add(crafter);
                    }
                }

                var sb = new Item[20];
                var mb = new List<Item>();

                foreach (var i in item)
                {
                    if (GetSingleBlockVoltageTier(i, out var tier))
                        sb[tier] = i;
                    else
                        mb.Add(i);
                }

                var maxTier = Array.FindLastIndex(sb, x => x != null);
                if (maxTier > -1)
                    type.singleblocks.AddRange(sb.Take(maxTier+1));
                type.multiblocks.AddRange(mb);
                type.defaultCrafter = type.singleblocks.FirstOrDefault(x => x != null)
                    ?? type.multiblocks.FirstOrDefault()
                    ?? type.crafters.FirstOrDefault();
            }
        }

        private static void ProcessToolTips<T>(List<T> goods) where T:Goods
        {
            var builder = new StringBuilder();
            foreach (var item in goods)
            {
                item.tooltip ??= "";
                var parts = item.tooltip.Split('\n');
                builder.Clear();
                for (var i = 1; i < parts.Length-1; i++)
                {
                    var part = parts[i];
                    if ((part.Contains("press", StringComparison.OrdinalIgnoreCase) || part.Contains("hold", StringComparison.OrdinalIgnoreCase)) &&
                        (part.Contains("ctrl", StringComparison.OrdinalIgnoreCase) || part.Contains("shift", StringComparison.OrdinalIgnoreCase) || part.Contains("control", StringComparison.OrdinalIgnoreCase)))
                        continue;
                    if (i == 1 && part == "")
                        continue;

                    builder.Append(part).Append('\n');
                }

                item.tooltip = builder.ToString();
            }
        }

        private static void AddToArrayBuffer(ref int[] arr, int id)
        {
            if (arr.Length == 0)
            {
                arr = new []{ id, 0, 0, 1 };
                return;
            }
            var l = arr[^1];
            if (arr[l - 1] == id)
                return;
            arr[l++] = id;
            if (l == arr.Length)
                Array.Resize(ref arr, arr.Length * 2);
            arr[^1] = l;
        }

        private static void TruncateArray(ref int[] arr)
        {
            if (arr.Length > 0)
                Array.Resize(ref arr, arr[^1]);
        }

        private static void CalculateProductionConsumption(Repository repository)
        {
            for (var recipeIndex = 0; recipeIndex < repository.recipes.Count; recipeIndex++)
            {
                var recipe = repository.recipes[recipeIndex];
                foreach (var production in recipe.itemOutputs)
                    AddToArrayBuffer(ref production.goods.production, recipeIndex);
                foreach (var production in recipe.itemInputs)
                    AddToArrayBuffer(ref production.goods.consumption, recipeIndex);
                foreach (var production in recipe.fluidOutputs)
                    AddToArrayBuffer(ref production.goods.production, recipeIndex);
                foreach (var production in recipe.fluidInputs)
                    AddToArrayBuffer(ref production.goods.consumption, recipeIndex);
                foreach (var oreDict in recipe.oreDictInputs)
                    foreach (var item in oreDict.goods.variants)
                        AddToArrayBuffer(ref item.consumption, recipeIndex);
            }
        }

        private static void Truncate(Repository repository)
        {
            foreach (var item in repository.items)
            {
                TruncateArray(ref item.production);
                TruncateArray(ref item.consumption);
            }
            
            foreach (var fluid in repository.fluids)
            {
                TruncateArray(ref fluid.production);
                TruncateArray(ref fluid.consumption);
                TruncateArray(ref fluid.containers);
            }
        }
        
        private static void CalculateIndexBits(Repository repository)
        {
            foreach (var oreDict in repository.oreDicts)
            {
                foreach (var variant in oreDict.variants)
                    oreDict.indexBits |= SearchIndex.GetIndexBits(variant.name);
            }

            foreach (var item in repository.items)
                item.indexBits = SearchIndex.GetIndexBits(item.name) | SearchIndex.GetIndexBits(item.tooltip);
            
            foreach (var fluid in repository.fluids)
                fluid.indexBits = SearchIndex.GetIndexBits(fluid.name) | SearchIndex.GetIndexBits(fluid.tooltip);

            foreach (var recipe in repository.recipes)
            {
                foreach (var input in recipe.fluidInputs)
                    recipe.indexBits |= SearchIndex.GetIndexBits(input.goods.name);
                foreach (var input in recipe.itemInputs)
                    recipe.indexBits |= SearchIndex.GetIndexBits(input.goods.name);
                foreach (var input in recipe.oreDictInputs)
                    recipe.indexBits |= input.goods.indexBits;
                foreach (var output in recipe.fluidOutputs)
                    recipe.indexBits |= SearchIndex.GetIndexBits(output.goods.name);
                foreach (var output in recipe.itemOutputs)
                    recipe.indexBits |= SearchIndex.GetIndexBits(output.goods.name);
            }
        }
    }
}