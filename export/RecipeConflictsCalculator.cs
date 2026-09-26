using Source.Data;
using System.Text.RegularExpressions;

namespace export;

public static class RecipeConflictsCalculator
{
    public static void CalculateRecipeConflicts(Repository repository)
    {
        Console.WriteLine("Calculating recipe conflicts...");
        foreach (var group in repository.recipes.GroupBy(x => x.recipeType))
        {
            var recipeInfos = new List<(Recipe recipe, int circuit, HashSet<GoodsOrDict> ingredients)>();
            
            foreach (var recipe in group)
            {
                var set = new HashSet<GoodsOrDict>();
                set.UnionWith(recipe.itemInputs.Where(x => x.amount > 0).Select(x => x.goods));
                set.UnionWith(recipe.fluidInputs.Where(x => x.amount > 0).Select(x => x.goods));
                set.UnionWith(recipe.oreDictInputs.Where(x => x.amount > 0).Select(x => x.goods));
                var circuit = 0;
                foreach (var input in recipe.itemInputs)
                {
                    if ((input.amount == 0 || input.probability == 0) && IsProgrammedCircuit(input.goods))
                    {
                        circuit = GetProgrammedCircuitConfiguration(input.goods);
                        break;
                    }
                }
                recipeInfos.Add((recipe, circuit, set));
            }

            foreach (var (recipe, circuit, ingredients) in recipeInfos)
            {
                if (recipe.gtInfo == null)
                    continue;
                foreach (var (_, outherCircuit, otherIngredients) in recipeInfos)
                {
                    if (outherCircuit != circuit && otherIngredients.IsSubsetOf(ingredients))
                        recipe.gtInfo.circuitConflicts |= (1 << outherCircuit);
                }
            }
        }
    }

    private static bool IsProgrammedCircuit(Item item)
        => item.mod == "gtceu" && item.internalName == "programmed_circuit";

    private static int GetProgrammedCircuitConfiguration(Item item)
    {
        if (!string.IsNullOrEmpty(item.nbt))
        {
            var nbtMatch = Regex.Match(item.nbt, @"configuration:(\d+)");
            if (nbtMatch.Success)
                return int.Parse(nbtMatch.Groups[1].Value);
        }
        if (!string.IsNullOrEmpty(item.tooltip))
        {
            var tooltipMatch = Regex.Match(item.tooltip, @"Configuration:\s*(\d+)");
            if (tooltipMatch.Success)
                return int.Parse(tooltipMatch.Groups[1].Value);
        }
        return item.damage;
    }
}