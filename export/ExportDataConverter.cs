using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Globalization;
using Source.Data;
using export;

namespace Source
{
    /// <summary>
    /// Reads the JSON-based export-data/ directory and builds the internal Repository model.
    /// Strict on schema (unknown JSON fields throw via UnmappedMemberHandling.Disallow); a missing
    /// directly-referenced item/fluid in a recipe is a hard error unless listed in IgnoredMissingRefs.
    /// </summary>
    public static class ExportDataConverter
    {
        private static readonly JsonSerializerOptions StrictOptions = new()
        {
            PropertyNameCaseInsensitive = false,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
            ReadCommentHandling = JsonCommentHandling.Skip,
        };

        // Recipe references to items/fluids that are known-missing and tolerated (populated as needed).
        private static readonly HashSet<string> IgnoredMissingRefs = new();

        // Recipe metadata keys to drop (non-numeric / not needed by the calculator).
        private static readonly HashSet<string> IgnoredRecipeMetadataKeys = new() { "layered_steps" };

        // Recipe types to exclude entirely (informational only, not real crafting).
        private static readonly HashSet<string> IgnoredRecipeTypes = new() { "gtceu:multiblock_info" };

        // Vanilla furnace recipe types run in GT machines at a fixed energy cost,
        // independent of the vanilla recipe. The recipe's own duration is used as the
        // cook time when present; otherwise these defaults apply. Keyed by fullTypeName.
        private static readonly Dictionary<string, (int durationTicks, int voltage)> VanillaGtTimings = new()
        {
            ["minecraft:smelting"] = (200, 16),     // 10 seconds, 16 EU/t
            ["minecraft:blasting"] = (100, 16),     // 5 seconds, 16 EU/t
        };

        // Hardcoded per-recipe-type transforms, keyed by recipe type id. Each runs on the raw
        // RecipeJson before item/fluid resolution and returns one or more recipes to emit in its
        // place (allowing both field edits and one-to-many expansion). The items dictionary is
        // passed so a transform can synthesize/look up resolved items (e.g. nbt-stripped variants).
        private static readonly Dictionary<string, Func<RecipeJson, Dictionary<string, Item>, List<RecipeJson>>> RecipeTransforms = new()
        {
            ["gtceu:bacterial_hydrocarbon_harvester"] = TransformBacterialHydrocarbonHarvester,
            ["gtceu:bacterial_breeding_vat"] = TransformBacterialBreedingVat,
        };

        #region JSON models

        private class GoodsEntryJson
        {
            public string tag { get; set; }
            public string id { get; set; }
            public string nbt { get; set; }
            public string displayName { get; set; }
            public string modName { get; set; }
            public List<string> tooltip { get; set; }
            public string image { get; set; }
            public Dictionary<string, JsonElement> metadata { get; set; }
        }

        private class StackJson
        {
            public string key { get; set; }
            public int count { get; set; }
            public int amount { get; set; }
            public int? probability { get; set; }
        }

        private class RecipeJson
        {
            public string id { get; set; }
            public string type { get; set; }
            public string fullTypeName { get; set; }
            public Dictionary<string, JsonElement> data { get; set; }
            public int duration { get; set; }
            public long voltage { get; set; }
            public Dictionary<string, StackJson> itemInputs { get; set; }
            public Dictionary<string, StackJson> fluidInputs { get; set; }
            public Dictionary<string, StackJson> itemOutputs { get; set; }
            public Dictionary<string, StackJson> fluidOutputs { get; set; }
        }

        private class RecipeTypeJson
        {
            public string id { get; set; }
            public string name { get; set; }
            public string fullTypeName { get; set; }
            public List<string> crafters { get; set; }
            public int[] itemInputDimensions { get; set; }
            public int[] itemOutputDimensions { get; set; }
            public int[] fluidInputDimensions { get; set; }
            public int[] fluidOutputDimensions { get; set; }
        }

        #endregion

        public static Repository Convert(string dataPath, List<string> icons)
        {
            var items = new Dictionary<string, Item>();
            var fluids = new Dictionary<string, Fluid>();
            var tags = new Dictionary<string, List<string>>();
            var fluidTags = new Dictionary<string, List<string>>();
            var recipeTypesById = new Dictionary<string, RecipeType>();
            var recipeTypes = new List<RecipeType>();
            var recipes = new List<Recipe>();
            var oreDicts = new List<OreDict>();
            var oreDictByTag = new Dictionary<string, OreDict>();
            var fluidOreDictByTag = new Dictionary<string, OreDict>();
            var missingRefs = new HashSet<string>();

            // --- Items ---
            foreach (var (key, entry) in ReadObject<GoodsEntryJson>(Path.Combine(dataPath, "items.json")))
            {
                if (entry.tag != null || key.StartsWith("#"))
                    continue;
                var fullId = entry.id ?? key;
                var item = new Item
                {
                    name = entry.displayName,
                    mod = Namespace(fullId),
                    internalName = InternalName(fullId),
                    tooltip = JoinTooltip(entry.tooltip),
                    nbt = entry.nbt,
                    stackSize = 64,
                    damage = 0,
                    numericId = 0,
                    imagePath = entry.image,
                };
                ApplyItemMetadata(item, entry.metadata, key);
                ApplyMaxEnergyStorage(item, entry.tooltip);
                ApplyAbsoluteParallels(item, entry.tooltip);
                items[key] = item;
            }

            // --- Fluids ---
            foreach (var (key, entry) in ReadObject<GoodsEntryJson>(Path.Combine(dataPath, "fluids.json")))
            {
                if (entry.tag != null || key.StartsWith("#"))
                    continue;
                var fullId = entry.id ?? key;
                fluids[key] = new Fluid
                {
                    name = entry.displayName,
                    mod = Namespace(fullId),
                    internalName = InternalName(fullId),
                    tooltip = JoinTooltip(entry.tooltip),
                    isGas = entry.tooltip != null && entry.tooltip.Any(t => t.Contains("State: Gas")),
                    nbt = entry.nbt,
                    numericId = 0,
                    imagePath = entry.image,
                };
            }

            // --- Tags ---
            var tagDir = Path.Combine(dataPath, "tags", "items");
            if (Directory.Exists(tagDir))
            {
                foreach (var file in Directory.EnumerateFiles(tagDir, "*.json", SearchOption.AllDirectories))
                {
                    var rel = Path.GetRelativePath(tagDir, file).Replace('\\', '/');
                    var noExt = rel.Substring(0, rel.Length - ".json".Length);
                    var slash = noExt.IndexOf('/');
                    if (slash < 0)
                        continue;
                    var tagId = noExt.Substring(0, slash) + ":" + noExt.Substring(slash + 1);
                    tags[tagId] = JsonSerializer.Deserialize<List<string>>(File.ReadAllText(file), StrictOptions);
                }
            }

            // --- Fluid tags ---
            var fluidTagDir = Path.Combine(dataPath, "tags", "fluids");
            if (Directory.Exists(fluidTagDir))
            {
                foreach (var file in Directory.EnumerateFiles(fluidTagDir, "*.json", SearchOption.AllDirectories))
                {
                    var rel = Path.GetRelativePath(fluidTagDir, file).Replace('\\', '/');
                    var noExt = rel.Substring(0, rel.Length - ".json".Length);
                    var slash = noExt.IndexOf('/');
                    if (slash < 0)
                        continue;
                    var tagId = noExt.Substring(0, slash) + ":" + noExt.Substring(slash + 1);
                    fluidTags[tagId] = JsonSerializer.Deserialize<List<string>>(File.ReadAllText(file), StrictOptions);
                }
            }

            // --- Recipe types ---
            foreach (var rt in ReadArray<RecipeTypeJson>(Path.Combine(dataPath, "recipeTypes.json")))
            {
                if (IgnoredRecipeTypes.Contains(rt.id))
                    continue;
                var type = new RecipeType
                {
                    name = rt.name,
                    category = Namespace(rt.id),
                    itemInputs = Dim(rt.itemInputDimensions),
                    itemOutputs = Dim(rt.itemOutputDimensions),
                    fluidInputs = Dim(rt.fluidInputDimensions),
                    fluidOutputs = Dim(rt.fluidOutputDimensions),
                    shapeless = false,
                };
                if (rt.crafters != null)
                {
                    foreach (var crafterId in rt.crafters)
                    {
                        if (items.TryGetValue(crafterId, out var crafterItem))
                        {
                            crafterItem.touched = true;
                            if (!type.crafters.Contains(crafterItem))
                                type.crafters.Add(crafterItem);
                        }
                    }
                }
                recipeTypesById[rt.id] = type;
                recipeTypes.Add(type);
            }

            // --- Recipes ---
            var recipesDir = Path.Combine(dataPath, "recipes");
            foreach (var file in Directory.EnumerateFiles(recipesDir, "*.json", SearchOption.AllDirectories))
            {
                foreach (var rjRaw in JsonSerializer.Deserialize<List<RecipeJson>>(File.ReadAllText(file), StrictOptions))
                {
                    if (IgnoredRecipeTypes.Contains(rjRaw.type))
                        continue;

                    // Hardcoded per-recipe-type transforms run on the raw JSON before resolution.
                    // A transform may edit fields and/or expand one recipe into several.
                    var transformed = RecipeTransforms.TryGetValue(rjRaw.type, out var transform)
                        ? transform(rjRaw, items)
                        : new List<RecipeJson> { rjRaw };

                    foreach (var rj in transformed)
                    {
                        if (!recipeTypesById.TryGetValue(rj.type, out var type))
                            throw new InvalidDataException($"Recipe '{rj.id}' references unknown recipe type '{rj.type}'");

                        var itemInputs = new List<RecipeInput<Item>>();
                        var oreInputs = new List<RecipeInput<OreDict>>();
                        var fluidInputs = new List<RecipeInput<Fluid>>();
                        var itemOutputs = new List<RecipeProduct<Item>>();
                        var fluidOutputs = new List<RecipeProduct<Fluid>>();
                        var skip = false;

                        foreach (var (slotStr, stack) in rj.itemInputs ?? Empty)
                        {
                            var slot = int.Parse(slotStr);
                            if (stack.key.StartsWith("#"))
                            {
                                var (single, ore) = ResolveTagInput(stack.key.Substring(1), tags, items, oreDicts, oreDictByTag);
                                if (single == null && ore == null)
                                    skip = true;
                                else if (ore != null)
                                    oreInputs.Add(new RecipeInput<OreDict> { goods = ore, amount = stack.count, slot = slot, probability = Prob(stack.probability) });
                                else
                                    itemInputs.Add(new RecipeInput<Item> { goods = single, amount = stack.count, slot = slot, probability = Prob(stack.probability) });
                            }
                            else
                            {
                                var it = ResolveItem(stack.key, items, missingRefs);
                                if (it == null) skip = true;
                                else { it.touched = true; itemInputs.Add(new RecipeInput<Item> { goods = it, amount = stack.count, slot = slot, probability = Prob(stack.probability) }); }
                            }
                        }

                        foreach (var (slotStr, stack) in rj.fluidInputs ?? Empty)
                        {
                            var slot = int.Parse(slotStr);
                            if (stack.key.StartsWith("#"))
                            {
                                var (single, ore) = ResolveFluidTagInput(stack.key.Substring(1), fluidTags, fluids, oreDicts, fluidOreDictByTag);
                                if (single == null && ore == null)
                                    skip = true;
                                else if (ore != null)
                                    oreInputs.Add(new RecipeInput<OreDict> { goods = ore, amount = stack.amount, slot = slot, probability = Prob(stack.probability) });
                                else
                                    fluidInputs.Add(new RecipeInput<Fluid> { goods = single, amount = stack.amount, slot = slot, probability = Prob(stack.probability) });
                            }
                            else
                            {
                                var fl = ResolveFluid(stack.key, fluids, missingRefs);
                                if (fl == null) skip = true;
                                else fluidInputs.Add(new RecipeInput<Fluid> { goods = fl, amount = stack.amount, slot = slot, probability = Prob(stack.probability) });
                            }
                        }

                        foreach (var (slotStr, stack) in rj.itemOutputs ?? Empty)
                        {
                            if (stack.key.StartsWith("#"))
                                throw new InvalidDataException($"Recipe '{rj.id}' has a tag '{stack.key}' as an item output, which is not supported");
                            var it = ResolveItem(stack.key, items, missingRefs);
                            if (it == null) skip = true;
                            else { it.touched = true; itemOutputs.Add(new RecipeProduct<Item> { goods = it, amount = stack.count, slot = int.Parse(slotStr), probability = Prob(stack.probability) }); }
                        }

                        foreach (var (slotStr, stack) in rj.fluidOutputs ?? Empty)
                        {
                            var fl = ResolveFluid(stack.key, fluids, missingRefs);
                            if (fl == null) skip = true;
                            else fluidOutputs.Add(new RecipeProduct<Fluid> { goods = fl, amount = stack.amount, slot = int.Parse(slotStr), probability = Prob(stack.probability) });
                        }

                        if (skip)
                            continue;

                        var recipe = new Recipe
                        {
                            id = "r:" + rj.id,
                            recipeType = type,
                            itemInputs = itemInputs.ToArray(),
                            oreDictInputs = oreInputs.ToArray(),
                            fluidInputs = fluidInputs.ToArray(),
                            itemOutputs = itemOutputs.ToArray(),
                            fluidOutputs = fluidOutputs.ToArray(),
                        };

                        if (Namespace(rj.type) == "gtceu")
                        {
                            recipe.gtInfo = new GtRecipeInfo
                            {
                                voltage = (int)Math.Min(rj.voltage, int.MaxValue),
                                durationTicks = rj.duration,
                                amperage = 1,
                                voltageTier = VoltageTiers.GetVoltageTierFromRaw(rj.voltage),
                                metadata = BuildRecipeMetadata(rj.data, rj.id),
                            };
                        }
                        else if (VanillaGtTimings.TryGetValue(rj.fullTypeName, out var timing))
                        {
                            recipe.gtInfo = new GtRecipeInfo
                            {
                                voltage = timing.voltage,
                                durationTicks = rj.duration > 0 ? rj.duration : timing.durationTicks,
                                amperage = 1,
                                voltageTier = VoltageTiers.GetVoltageTierFromRaw(timing.voltage),
                                metadata = BuildRecipeMetadata(rj.data, rj.id),
                            };
                        }

                        recipes.Add(recipe);
                    }
                }
            }

            var unresolved = missingRefs.Where(r => !IgnoredMissingRefs.Contains(r)).ToList();
            if (unresolved.Count > 0)
                throw new InvalidDataException($"Unresolved item/fluid references in recipes ({unresolved.Count}):\n" +
                    string.Join("\n", unresolved.Take(50)) + (unresolved.Count > 50 ? "\n..." : ""));

            // --- Icons: all fluids first, then touched items (iconId = index into icons list) ---
            foreach (var fluid in fluids.Values)
            {
                fluid.iconId = icons.Count;
                icons.Add(fluid.imagePath);
            }
            foreach (var item in items.Values)
            {
                if (!item.touched)
                    continue;
                item.iconId = icons.Count;
                icons.Add(item.imagePath);
            }

            var repository = new Repository
            {
                items = items.Values.Where(x => x.touched).ToList(),
                fluids = fluids.Values.ToList(),
                oreDicts = oreDicts,
                recipeTypes = recipeTypes,
                recipes = recipes,
            };

            foreach (var item in repository.items)
                item.GenerateId();
            foreach (var fluid in repository.fluids)
                fluid.GenerateId();
            foreach (var oreDict in repository.oreDicts)
                oreDict.GenerateId(repository);

            return repository;
        }

        private static readonly Dictionary<string, StackJson> Empty = new();

        private static (Item single, OreDict ore) ResolveTagInput(string tagId, Dictionary<string, List<string>> tags,
            Dictionary<string, Item> items, List<OreDict> oreDicts, Dictionary<string, OreDict> oreDictByTag)
        {
            if (oreDictByTag.TryGetValue(tagId, out var cached))
                return (null, cached);

            var memberIds = new List<string>();
            ResolveTag(tagId, tags, memberIds, new HashSet<string>(), new HashSet<string>());

            var variants = new List<Item>();
            foreach (var mid in memberIds)
            {
                if (items.TryGetValue(mid, out var it) && !variants.Contains(it))
                {
                    it.touched = true;
                    variants.Add(it);
                }
            }

            if (variants.Count == 0)
                return (null, null);
            if (variants.Count == 1)
                return (variants[0], null);

            var ore = new OreDict { id = tagId, variants = variants.ToArray() };
            oreDictByTag[tagId] = ore;
            oreDicts.Add(ore);
            return (null, ore);
        }

        private static (Fluid single, OreDict ore) ResolveFluidTagInput(string tagId, Dictionary<string, List<string>> fluidTags,
            Dictionary<string, Fluid> fluids, List<OreDict> oreDicts, Dictionary<string, OreDict> fluidOreDictByTag)
        {
            if (fluidOreDictByTag.TryGetValue(tagId, out var cached))
                return (null, cached);

            var memberIds = new List<string>();
            ResolveTag(tagId, fluidTags, memberIds, new HashSet<string>(), new HashSet<string>());

            var variants = new List<Goods>();
            foreach (var mid in memberIds)
            {
                if (fluids.TryGetValue(mid, out var fl) && !variants.Contains(fl))
                    variants.Add(fl);
            }

            if (variants.Count == 0)
                return (null, null);
            if (variants.Count == 1)
                return ((Fluid)variants[0], null);

            // Distinct id prefix so a fluid tag never collides with an item tag of the same id.
            var ore = new OreDict { id = "fluid:" + tagId, variants = variants.ToArray() };
            fluidOreDictByTag[tagId] = ore;
            oreDicts.Add(ore);
            return (null, ore);
        }

        private static void ResolveTag(string tagId, Dictionary<string, List<string>> tags, List<string> result,
            HashSet<string> seen, HashSet<string> visited)
        {
            if (!visited.Add(tagId) || !tags.TryGetValue(tagId, out var members))
                return;
            foreach (var member in members)
            {
                if (member.StartsWith("#"))
                    ResolveTag(member.Substring(1), tags, result, seen, visited);
                else if (seen.Add(member))
                    result.Add(member);
            }
        }

        private static Item ResolveItem(string key, Dictionary<string, Item> items, HashSet<string> missingRefs)
        {
            if (items.TryGetValue(key, out var item))
                return item;
            missingRefs.Add(key);
            return null;
        }

        private static Fluid ResolveFluid(string key, Dictionary<string, Fluid> fluids, HashSet<string> missingRefs)
        {
            if (fluids.TryGetValue(key, out var fluid))
                return fluid;
            missingRefs.Add(key);
            return null;
        }

        private static RecipeMetadata[] BuildRecipeMetadata(Dictionary<string, JsonElement> data, string recipeId)
        {
            if (data == null || data.Count == 0)
                return Array.Empty<RecipeMetadata>();
            var list = new List<RecipeMetadata>(data.Count);
            foreach (var (key, value) in data)
            {
                if (IgnoredRecipeMetadataKeys.Contains(key))
                    continue;
                switch (value.ValueKind)
                {
                    case JsonValueKind.Number:
                        list.Add(new RecipeMetadata { key = key, value = value.GetDouble() });
                        break;
                    case JsonValueKind.True:
                    case JsonValueKind.False:
                        list.Add(new RecipeMetadata { key = key, value = value.GetBoolean() ? 1 : 0 });
                        break;
                    default:
                        throw new InvalidDataException($"Recipe '{recipeId}' metadata key '{key}' has unsupported value kind {value.ValueKind}");
                }
            }
            return list.ToArray();
        }

        private static void ApplyItemMetadata(Item item, Dictionary<string, JsonElement> metadata, string itemKey)
        {
            if (metadata == null)
                return;
            foreach (var (key, value) in metadata)
            {
                if (key == "recipeModifiers")
                {
                    if (value.ValueKind != JsonValueKind.Array)
                        throw new InvalidDataException($"Item '{itemKey}' metadata 'recipeModifiers' is not an array");
                    foreach (var modifier in value.EnumerateArray())
                        item.recipeModifiers.Add(modifier.GetString());
                }
                else if (value.ValueKind == JsonValueKind.Number)
                {
                    item.metadata.Add(new ItemMetadata { key = key, value = value.GetInt64() });
                }
                else if (value.ValueKind is JsonValueKind.True or JsonValueKind.False)
                {
                    item.metadata.Add(new ItemMetadata { key = key, value = value.GetBoolean() ? 1 : 0 });
                }
                else
                {
                    throw new InvalidDataException($"Item '{itemKey}' metadata key '{key}' has unsupported value kind {value.ValueKind}");
                }
            }
        }

        // Matches tooltip lines like "Maximum Energy Storage: 320M EU" (after stripping
        // Minecraft formatting codes). Captures the number and optional magnitude suffix.
        private static readonly Regex MaxEnergyStorageRegex = new(
            @"Maximum Energy Storage:\s*([\d,.]+)\s*([KMGTP]?)\s*EU",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Fusion reactors (and similar machines) expose their energy buffer only in the
        // tooltip. Parse it into a numeric `maxEnergyStorage` metadata so the calculator
        // can compare it against a recipe's eu_to_start requirement.
        private static void ApplyMaxEnergyStorage(Item item, List<string> tooltipLines)
        {
            if (tooltipLines == null)
                return;
            foreach (var rawLine in tooltipLines)
            {
                var line = Regex.Replace(rawLine, "\u00A7.", "");
                var match = MaxEnergyStorageRegex.Match(line);
                if (!match.Success)
                    continue;
                var number = double.Parse(match.Groups[1].Value.Replace(",", ""), CultureInfo.InvariantCulture);
                var multiplier = match.Groups[2].Value.ToUpperInvariant() switch
                {
                    "K" => 1_000d,
                    "M" => 1_000_000d,
                    "G" => 1_000_000_000d,
                    "T" => 1_000_000_000_000d,
                    "P" => 1_000_000_000_000_000d,
                    _ => 1d,
                };
                item.metadata.Add(new ItemMetadata { key = "maxEnergyStorage", value = (long)Math.Round(number * multiplier) });
                return;
            }
        }

        // Matches tooltip lines like "Allows to run up to 8 recipes in parallel."
        // (after stripping Minecraft formatting codes). Captures the parallel count.
        private static readonly Regex AbsoluteParallelsRegex = new(
            @"Allows to run up to\s*([\d,]+)\s*recipes in parallel",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Absolute Parallel Mastery Hatches expose how many free parallels they grant
        // only in the tooltip. Parse it into an `absoluteParallels` metadata. Regular
        // Parallel Control Hatches share the "Allows to run up to N..." line, so only
        // treat hatches whose tooltip also advertises the energy-free parallels.
        private static void ApplyAbsoluteParallels(Item item, List<string> tooltipLines)
        {
            if (tooltipLines == null)
                return;
            var strippedLines = tooltipLines.Select(rawLine => Regex.Replace(rawLine, "\u00A7.", "")).ToList();
            var isAbsolute = strippedLines.Any(line =>
                line.IndexOf("Without extra energy consumption", StringComparison.OrdinalIgnoreCase) >= 0);
            if (!isAbsolute)
                return;
            foreach (var line in strippedLines)
            {
                var match = AbsoluteParallelsRegex.Match(line);
                if (!match.Success)
                    continue;
                var count = long.Parse(match.Groups[1].Value.Replace(",", ""), CultureInfo.InvariantCulture);
                item.metadata.Add(new ItemMetadata { key = "absoluteParallels", value = count });
                return;
            }
        }

        #region Hardcoded recipe transforms

        // gtceu:bacterial_hydrocarbon_harvester:
        //  - strip nbt from item inputs (synthesizing a clean item when no nbt-less base exists),
        //  - force the minecraft:sugar input count to 2,
        //  - force the #forge:biomass fluid input to 200,
        //  - expand into one recipe per permutation of the first 3 fluid output keys (amounts stay
        //    bound to their slot; only the keys are permuted).
        private static List<RecipeJson> TransformBacterialHydrocarbonHarvester(RecipeJson rj, Dictionary<string, Item> items)
        {
            foreach (var stack in (rj.itemInputs ?? Empty).Values)
            {
                stack.key = StripItemNbt(stack.key, items);
                if (stack.key == "minecraft:sugar")
                    stack.count = 2;
            }

            foreach (var stack in (rj.fluidInputs ?? Empty).Values)
            {
                if (stack.key == "#forge:biomass")
                    stack.amount = 200;
            }

            return PermuteFirstNFluidOutputKeys(rj, 3);
        }

        // gtceu:bacterial_breeding_vat:
        //  - strip nbt from item inputs and item outputs (synthesizing clean items as needed),
        //  - combine item outputs that became the same item after stripping (summing their counts).
        private static List<RecipeJson> TransformBacterialBreedingVat(RecipeJson rj, Dictionary<string, Item> items)
        {
            foreach (var stack in (rj.itemInputs ?? Empty).Values)
                stack.key = StripItemNbt(stack.key, items);
            foreach (var stack in (rj.itemOutputs ?? Empty).Values)
                stack.key = StripItemNbt(stack.key, items);

            rj.itemOutputs = CombineSameItemStacks(rj.itemOutputs);
            return new List<RecipeJson> { rj };
        }

        // Merges item stacks that share the same key into a single stack, summing counts and keeping
        // the lowest slot number. Used after nbt-stripping makes formerly-distinct variants identical.
        private static Dictionary<string, StackJson> CombineSameItemStacks(Dictionary<string, StackJson> stacks)
        {
            if (stacks == null)
                return null;
            var byKey = new Dictionary<string, (int slot, StackJson stack)>();
            foreach (var (slotStr, stack) in stacks)
            {
                var slot = int.Parse(slotStr);
                if (byKey.TryGetValue(stack.key, out var existing))
                {
                    existing.stack.count += stack.count;
                    if (slot < existing.slot)
                        byKey[stack.key] = (slot, existing.stack);
                }
                else
                {
                    byKey[stack.key] = (slot, stack);
                }
            }
            return byKey.Values.ToDictionary(v => v.slot.ToString(), v => v.stack);
        }

        // Strips the "#<nbt-hash>" suffix from an item key. Tags (leading '#') are left as-is.
        // When the resulting nbt-less base key has no entry of its own, a clean copy of the nbt
        // variant is synthesized under the base key so the recipe resolves to a single, nbt-free item.
        private static string StripItemNbt(string key, Dictionary<string, Item> items)
        {
            if (key.StartsWith("#"))
                return key;
            var hashIndex = key.IndexOf('#');
            if (hashIndex < 0)
                return key;
            var baseKey = key.Substring(0, hashIndex);
            if (!items.ContainsKey(baseKey) && items.TryGetValue(key, out var variant))
                items[baseKey] = CloneItemWithoutNbt(variant);
            return baseKey;
        }

        private static Item CloneItemWithoutNbt(Item source) => new()
        {
            name = source.name,
            mod = source.mod,
            internalName = source.internalName,
            tooltip = source.tooltip,
            nbt = null,
            stackSize = source.stackSize,
            damage = source.damage,
            numericId = source.numericId,
            imagePath = source.imagePath,
            recipeModifiers = new List<string>(source.recipeModifiers),
            metadata = new List<ItemMetadata>(source.metadata),
        };

        // Produces one recipe clone per permutation of the keys of the first n fluid output slots
        // (slots taken in ascending numeric order). Output amounts stay attached to their slot;
        // only the keys move. Slots beyond the first n are left unchanged.
        private static List<RecipeJson> PermuteFirstNFluidOutputKeys(RecipeJson rj, int n)
        {
            var outputs = rj.fluidOutputs;
            if (outputs == null)
                return new List<RecipeJson> { rj };
            var slots = outputs.Keys.OrderBy(int.Parse).Take(n).ToList();
            if (slots.Count < n)
                return new List<RecipeJson> { rj };

            var keys = slots.Select(s => outputs[s].key).ToList();
            var result = new List<RecipeJson>();
            var permIndex = 0;
            foreach (var perm in Permutations(keys))
            {
                var clone = CloneRecipe(rj);
                for (var i = 0; i < slots.Count; i++)
                    clone.fluidOutputs[slots[i]].key = perm[i];
                clone.id = rj.id + "/p" + permIndex;
                result.Add(clone);
                permIndex++;
            }
            return result;
        }

        private static IEnumerable<List<T>> Permutations<T>(List<T> items)
        {
            if (items.Count <= 1)
            {
                yield return new List<T>(items);
                yield break;
            }
            for (var i = 0; i < items.Count; i++)
            {
                var rest = new List<T>(items);
                rest.RemoveAt(i);
                foreach (var perm in Permutations(rest))
                {
                    perm.Insert(0, items[i]);
                    yield return perm;
                }
            }
        }

        private static RecipeJson CloneRecipe(RecipeJson source) => new()
        {
            id = source.id,
            type = source.type,
            fullTypeName = source.fullTypeName,
            data = source.data,
            duration = source.duration,
            voltage = source.voltage,
            itemInputs = CloneStacks(source.itemInputs),
            fluidInputs = CloneStacks(source.fluidInputs),
            itemOutputs = CloneStacks(source.itemOutputs),
            fluidOutputs = CloneStacks(source.fluidOutputs),
        };

        private static Dictionary<string, StackJson> CloneStacks(Dictionary<string, StackJson> source)
        {
            if (source == null)
                return null;
            var clone = new Dictionary<string, StackJson>(source.Count);
            foreach (var (k, v) in source)
                clone[k] = new StackJson { key = v.key, count = v.count, amount = v.amount, probability = v.probability };
            return clone;
        }

        #endregion

        private static int Prob(int? probability)
            => probability ?? 10000;

        private static RecipeDimensions Dim(int[] dims)
            => dims is { Length: >= 2 } ? new RecipeDimensions(dims[0], dims[1]) : new RecipeDimensions(0, 0);

        private static string Namespace(string id)
        {
            var colon = id.IndexOf(':');
            return colon < 0 ? id : id.Substring(0, colon);
        }

        private static string InternalName(string id)
        {
            var colon = id.IndexOf(':');
            return colon < 0 ? id : id.Substring(colon + 1);
        }

        private static string JoinTooltip(List<string> lines)
            => lines == null || lines.Count == 0 ? "" : string.Join("\n", lines) + "\n";

        private static Dictionary<string, T> ReadObject<T>(string path)
            => JsonSerializer.Deserialize<Dictionary<string, T>>(File.ReadAllText(path), StrictOptions);

        private static List<T> ReadArray<T>(string path)
            => JsonSerializer.Deserialize<List<T>>(File.ReadAllText(path), StrictOptions);
    }
}
