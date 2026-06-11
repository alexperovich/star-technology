using System.Collections;
using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using Source.Data;
using CompressionLevel = System.IO.Compression.CompressionLevel;

namespace Source
{
    public class MemoryMappedPackConverter
    {
        private readonly Repository repository;
        private readonly Dictionary<object, int> objects = new Dictionary<object, int>();

        private readonly List<(object, int)> writePositions = new List<(object, int)>();
        private readonly Stack<object> objectsToWrite = new Stack<object>();

        private readonly List<int> rawData = new List<int>();
        private readonly string[] serviceItems = new[] { "Quest Book", "Anvil" };
        
        private const int DATA_VERSION = 6;

        public MemoryMappedPackConverter(Repository repository)
        {
            this.repository = repository;
            WriteInt(DATA_VERSION);
            WriteObjectRef(repository.items);
            WriteObjectRef(repository.fluids);
            WriteObjectRef(repository.oreDicts);
            WriteObjectRef(repository.recipeTypes);
            WriteObjectRef(repository.recipes);
            WriteObjectRef(Array.ConvertAll(serviceItems, x => this.repository.items.FirstOrDefault(y => y.name == x)));
            WriteObjectRef(repository.remaps);
        }

        private void WriteInt(int i)
        {
            rawData.Add(i);
        }
        
        private void WriteDouble(double d)
        {
            var bits = BitConverter.DoubleToUInt64Bits(d);
            var low = (int)(bits & 0xFFFFFFFF);
            var high = (int)(bits >> 32);
            WriteInt(low);
            WriteInt(high);
        }
        
        private void WriteStringRef(string s)
        {
            rawData.Add(-1);
            if (string.IsNullOrEmpty(s))
                return;
            writePositions.Add((s, rawData.Count - 1));
        }

        private void WriteObjectRef(object o)
        {
            rawData.Add(-1);
            if (o == null)
                return;
            if (o is IList list && list.Count == 0)
                o = Array.Empty<int>(); // Write single empty array
            if (objects.TryAdd(o, 0))
                objectsToWrite.Push(o);
            writePositions.Add((o, rawData.Count - 1));
        }

        private void WriteObjectVerbatim(object o)
        {
            objects[o] = rawData.Count;

            switch (o)
            {
                case Item item: Write(item); return;
                case Fluid fluid: Write(fluid); return;
                case RecipeType recipeType: Write(recipeType); return;
                case Recipe recipe: Write(recipe); return;
                case OreDict oreDict: Write(oreDict); return;
                case GtRecipeInfo gtRecipe: Write(gtRecipe); return;
                case RecipeMetadata metadata: Write(metadata); return;
                case ItemMetadata itemMetadata: Write(itemMetadata); return;
                case FluidContainer container: Write(container); return;
                case int[] intArr: Write(intArr); return;
                case IList genericList: Write(genericList); return;
                case RecipeRemap remap: Write(remap); return;
                case int i: WriteInt(i); return;
                case string s: WriteStringRef(s); return;
                default: throw new InvalidOperationException("Unexpected type: "+o.GetType());
            }
        }

        private void Write(IList genericList)
        {
            WriteInt(genericList.Count);
            foreach (var elem in genericList)
                if (elem is int i)
                    WriteInt(i); 
                else WriteObjectRef(elem);
        }

        private void Write(int[] elements)
        {
            WriteInt(elements.Length);
            foreach (var elem in elements)
                WriteInt(elem);
        }

        private void Write(GtRecipeInfo gtRecipe)
        {
            WriteInt(gtRecipe.voltage);
            WriteInt(gtRecipe.durationTicks);
            WriteInt(gtRecipe.amperage);
            WriteInt(gtRecipe.voltageTier);
            WriteObjectRef(gtRecipe.metadata);
            WriteInt(gtRecipe.circuitConflicts);
        }
        
        private void Write(RecipeMetadata metadata)
        {
            WriteStringRef(metadata.key);
            WriteDouble(metadata.value);
        }

        private void Write(ItemMetadata metadata)
        {
            WriteStringRef(metadata.key);
            WriteDouble(metadata.value);
        }

        private void WriteIndexBits(IndexableObject obj)
        {
            Span<byte> buf = stackalloc byte[16];
            Unsafe.WriteUnaligned(ref buf[0], obj.indexBits);
            WriteInt(Unsafe.ReadUnaligned<int>(ref buf[0]));
            WriteInt(Unsafe.ReadUnaligned<int>(ref buf[4]));
            WriteInt(Unsafe.ReadUnaligned<int>(ref buf[8]));
            WriteInt(Unsafe.ReadUnaligned<int>(ref buf[12]));
            WriteStringRef(obj.id);
        }

        private void Write(OreDict dict)
        {
            WriteIndexBits(dict);
            WriteObjectRef(dict.variants);
        }
        
        private void Write(RecipeRemap remap)
        {
            WriteStringRef(remap.from);
            WriteObjectRef(remap.to);
        }

        // RecipeIoType ordering — must match src/repository.ts.
        private const int IoItemInput = 0, IoOreDictInput = 1, IoFluidInput = 2, IoFluidOreDictInput = 3, IoItemOutput = 4, IoFluidOutput = 5;

        private object[] PackRecipeInOut(Recipe recipe)
        {
            var totalIO = recipe.fluidInputs.Length + recipe.fluidOutputs.Length + recipe.itemInputs.Length + recipe.itemOutputs.Length + recipe.oreDictInputs.Length;
            var arr = new object[totalIO * 5];
            var index = 0;
            foreach (var input in recipe.itemInputs)
                WriteRecipeSlot(arr, ref index, IoItemInput, input.goods, input.slot, input.amount, input.probability);
            foreach (var input in recipe.oreDictInputs)
                if (!IsFluidOreDict(input.goods))
                    WriteRecipeSlot(arr, ref index, IoOreDictInput, input.goods, input.slot, input.amount, input.probability);
            foreach (var input in recipe.fluidInputs)
                WriteRecipeSlot(arr, ref index, IoFluidInput, input.goods, input.slot, input.amount, input.probability);
            foreach (var input in recipe.oreDictInputs)
                if (IsFluidOreDict(input.goods))
                    WriteRecipeSlot(arr, ref index, IoFluidOreDictInput, input.goods, input.slot, input.amount, input.probability);
            foreach (var output in recipe.itemOutputs)
                WriteRecipeSlot(arr, ref index, IoItemOutput, output.goods, output.slot, output.amount, output.probability);
            foreach (var output in recipe.fluidOutputs)
                WriteRecipeSlot(arr, ref index, IoFluidOutput, output.goods, output.slot, output.amount, output.probability);
            return arr;
        }

        private static bool IsFluidOreDict(OreDict ore)
            => ore.variants.Length > 0 && ore.variants[0] is Fluid;

        private void WriteRecipeSlot(object[] arr, ref int index, int ioType, object goods, int slot, int amount, int probability)
        {
            arr[index++] = ioType;
            arr[index++] = goods;
            arr[index++] = slot;
            arr[index++] = amount;
            arr[index++] = probability;
        }

        private void Write(Recipe recipe)
        {
            WriteIndexBits(recipe);
            WriteObjectRef(PackRecipeInOut(recipe));
            WriteObjectRef(recipe.recipeType);
            WriteObjectRef(recipe.gtInfo);
        }

        private void Write(RecipeType recipeType)
        {
            WriteStringRef(recipeType.name);
            WriteStringRef(recipeType.category);
            WriteObjectRef(new[]
            {
                recipeType.itemInputs.x, recipeType.itemInputs.y, recipeType.fluidInputs.x, recipeType.fluidInputs.y, 
                recipeType.itemOutputs.x, recipeType.itemOutputs.y, recipeType.fluidOutputs.x, recipeType.fluidOutputs.y
            });
            WriteObjectRef(recipeType.multiblocks);
            WriteInt(recipeType.shapeless ? 1 : 0);
            WriteObjectRef(recipeType.singleblocks);
            WriteObjectRef(recipeType.defaultCrafter);
        }

        private void WriteGoods(Goods goods)
        {
            WriteIndexBits(goods);
            WriteStringRef(MinecraftTextConverter.ToHtml(goods.name));
            WriteStringRef(goods.mod);
            WriteStringRef(goods.internalName);
            WriteInt(goods.numericId);
            WriteInt(goods.iconId);
            WriteStringRef(MinecraftTextConverter.ToHtml(goods.tooltip));
            WriteStringRef(goods.unlocalizedName);
            WriteStringRef(goods.nbt);
            WriteObjectRef(Array.ConvertAll(goods.production, x => repository.recipes[x]).ToArray());
            WriteObjectRef(Array.ConvertAll(goods.consumption, x => repository.recipes[x]).ToArray());
        }
        
        private void Write(Fluid fluid)
        {
            WriteGoods(fluid);
            WriteInt(fluid.isGas ? 1 : 0);
            WriteObjectRef(fluid.containers);
        }

        private void Write(Item item)
        {
            WriteGoods(item);
            WriteInt(item.stackSize);
            WriteInt(item.damage);
            WriteObjectRef(item.container);
            WriteObjectRef(item.recipeModifiers);
            WriteObjectRef(item.metadata);
        }

        private void Write(FluidContainer container)
        {
            WriteObjectRef(container.fluid);
            WriteInt(container.amount);
            WriteObjectRef(container.empty);
        }

        public byte[] Compile()
        {
            while (objectsToWrite.TryPop(out var o))
                WriteObjectVerbatim(o);
            
            var stringPositions = new Dictionary<string, int>();
            foreach (var (obj, pos) in writePositions)
            {
                if (obj is string s)
                {
                    if (!stringPositions.TryGetValue(s, out var existingPos))
                    {
                        stringPositions[s] = existingPos = rawData.Count;
                        var processedString = s.Trim().Replace("\r", "");
                        var stringBytes = Encoding.UTF8.GetBytes(processedString).AsSpan();
                        rawData.Add(stringBytes.Length);
                        while (stringBytes.Length > 0)
                        {
                            var part = stringBytes.Slice(0, Math.Min(stringBytes.Length, 4));
                            var i = Unsafe.ReadUnaligned<int>(ref MemoryMarshal.GetReference(part));
                            stringBytes = stringBytes.Slice(part.Length);
                            rawData.Add(i);
                        }
                    }
                    rawData[pos] = existingPos;
                }
                else
                {
                    rawData[pos] = objects[obj];
                }
            }

            var resultData = rawData.ToArray();
            var resultDataAsBytes = MemoryMarshal.AsBytes(resultData.AsSpan());
            var finalMemory = new MemoryStream();
            {
                using var zip = new GZipStream(finalMemory, CompressionLevel.Optimal);
                zip.Write(resultDataAsBytes);
                zip.Flush();
            }
            return finalMemory.ToArray();
        }
    }
}