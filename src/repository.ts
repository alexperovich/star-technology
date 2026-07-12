import { SearchQuery } from "./searchQuery.js";
import { SetCoilTiers, CoilTier, SetRotorHolders, RotorHolderTier, SetTurbineRotors, TurbineRotor, SetReflectorTiers, ReflectorTier, SetParallelHatchTiers, SetAbsoluteParallelHatchTiers, ParallelHatchTier, stripFormatting } from "./utils.js";

const charCodeItem = "i".charCodeAt(0);
const charCodeFluid = "f".charCodeAt(0);
const charCodeRecipe = "r".charCodeAt(0);

const DATA_VERSION = 7;
export class Repository
{
    static current:Repository;

    elements: Int32Array;
    bytes: Uint8Array;
    view: DataView;
    textReader: TextDecoder;
    objects: {[index:number]: (MemMappedObject | Int32Array | string)} = {}
    items:Int32Array;
    fluids:Int32Array;
    recipeTypes:Int32Array;
    recipes:Int32Array;
    oreDicts:Int32Array;
    service:Int32Array;

    objectPositionMap: {[id:string]:number} = {};

    constructor(data: ArrayBuffer)
    {
        this.bytes = new Uint8Array(data);
        this.elements = new Int32Array(data);
        this.view = new DataView(data);
        this.textReader = new TextDecoder();
        let dataVersion = this.elements[0];
        if (dataVersion != DATA_VERSION)
            throw new Error(`Unsupported data version: ${dataVersion} (Required: ${DATA_VERSION}). This may be caused by the browser cache. Please try reloading using F5 or Ctrl+F5.`);

        this.items = this.GetSlice(this.elements[1]);
        this.fluids = this.GetSlice(this.elements[2]);
        this.oreDicts = this.GetSlice(this.elements[3]);
        this.recipeTypes = this.GetSlice(this.elements[4]);
        this.recipes = this.GetSlice(this.elements[5]);
        this.service = this.GetSlice(this.elements[6]);
        this.FillObjectPositionMap(this.items);
        this.FillObjectPositionMap(this.fluids);
        this.FillObjectPositionMap(this.oreDicts);
        this.FillObjectPositionMap(this.recipes);

        let remap = this.ReadSlice(this.elements[7]);
        this.FillRecipesRemap(remap);
    }

    static load(data: ArrayBuffer): Repository {
        const repository = new Repository(data);
        Repository.current = repository;
        repository.LoadCoilTiers();
        repository.LoadRotorHolders();
        repository.LoadTurbineRotors();
        repository.LoadReflectorTiers();
        repository.LoadParallelHatches();
        return repository;
    }

    private LoadCoilTiers() {
        const coils:(CoilTier & {tier:number})[] = [];
        for (let i = 0; i < this.items.length; i++) {
            const item = this.GetObject(this.items[i], Item);
            let coilTier = -1;
            let baseHeatCapacity = 0;
            let smelterLevel = 0;
            let energyDiscount = 0;
            let hasHeatCapacity = false;
            for (const metadata of item.metadata) {
                switch (metadata.key) {
                    case "coilTier": coilTier = metadata.value; break;
                    case "baseHeatCapacity": baseHeatCapacity = metadata.value; hasHeatCapacity = true; break;
                    case "smelterLevel": smelterLevel = metadata.value; break;
                    case "energyDiscount": energyDiscount = metadata.value; break;
                }
            }
            if (coilTier < 0 || !hasHeatCapacity)
                continue;
            let name = item.name;
            const suffix = " Coil Block";
            if (name.endsWith(suffix))
                name = name.slice(0, -suffix.length);
            coils.push({ tier: coilTier, name, baseHeatCapacity, smelterLevel, energyDiscount });
        }
        if (coils.length === 0)
            return;
        coils.sort((a, b) => a.tier - b.tier);
        SetCoilTiers(coils.map(c => ({ name: c.name, baseHeatCapacity: c.baseHeatCapacity, smelterLevel: c.smelterLevel, energyDiscount: c.energyDiscount })));
    }

    private LoadRotorHolders() {
        const holders:RotorHolderTier[] = [];
        for (let i = 0; i < this.items.length; i++) {
            const item = this.GetObject(this.items[i], Item);
            let tier = -1;
            let maxSpeed = 0;
            for (const metadata of item.metadata) {
                switch (metadata.key) {
                    case "rotorHolderTier": tier = metadata.value; break;
                    case "maxRotorHolderSpeed": maxSpeed = metadata.value; break;
                }
            }
            if (tier < 0)
                continue;
            let name = stripFormatting(item.name);
            const suffix = " Rotor Holder";
            if (name.endsWith(suffix))
                name = name.slice(0, -suffix.length);
            if (holders.some(h => h.tier === tier))
                continue;
            holders.push({ tier, name, maxSpeed });
        }
        if (holders.length === 0)
            return;
        holders.sort((a, b) => a.tier - b.tier);
        SetRotorHolders(holders);
    }

    private LoadTurbineRotors() {
        const rotors:TurbineRotor[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < this.items.length; i++) {
            const item = this.GetObject(this.items[i], Item);
            let efficiency = -1;
            let power = -1;
            for (const metadata of item.metadata) {
                switch (metadata.key) {
                    case "turbineEfficiency": efficiency = metadata.value; break;
                    case "turbinePower": power = metadata.value; break;
                }
            }
            if (power < 0 || efficiency < 0)
                continue;
            let name = stripFormatting(item.name);
            const suffix = " Turbine Rotor";
            // Skip the generic, material-less "Turbine Rotor" variant (it does not
            // carry a material prefix and so won't end with " Turbine Rotor").
            if (!name.endsWith(suffix))
                continue;
            const material = name.slice(0, -suffix.length);
            if (material.length === 0 || seen.has(material))
                continue;
            seen.add(material);
            rotors.push({ name: material, efficiency, power });
        }
        if (rotors.length === 0)
            return;
        rotors.sort((a, b) => a.power - b.power || a.name.localeCompare(b.name));
        SetTurbineRotors(rotors);
    }

    private LoadReflectorTiers() {
        const tiers:ReflectorTier[] = [];
        const seen = new Set<number>();
        for (let i = 0; i < this.items.length; i++) {
            const item = this.GetObject(this.items[i], Item);
            if (!item.internalName.endsWith("_reflector_casing"))
                continue;
            // The tier is encoded in the tooltip ("Tier T<n>"), not in metadata.
            const tooltip = stripFormatting(item.tooltip ?? "");
            const match = tooltip.match(/Tier\s+T(\d+)/);
            if (!match)
                continue;
            const tier = parseInt(match[1], 10);
            if (seen.has(tier))
                continue;
            seen.add(tier);
            let name = stripFormatting(item.name);
            const suffix = " Neutron Reflector Casing";
            if (name.endsWith(suffix))
                name = name.slice(0, -suffix.length);
            tiers.push({ tier, name });
        }
        if (tiers.length === 0)
            return;
        tiers.sort((a, b) => a.tier - b.tier);
        SetReflectorTiers(tiers);
    }

    private LoadParallelHatches() {
        // Parallel Control Hatches carry a `maxParallel` metadata value; Absolute
        // Parallel Mastery Hatches carry `absoluteParallels`. Both map to a list of
        // selectable parallel counts.
        const parallel:ParallelHatchTier[] = [];
        const absolute:ParallelHatchTier[] = [];
        const seenParallel = new Set<number>();
        const seenAbsolute = new Set<number>();
        for (let i = 0; i < this.items.length; i++) {
            const item = this.GetObject(this.items[i], Item);
            let maxParallel = -1;
            let absoluteParallels = -1;
            for (const metadata of item.metadata) {
                switch (metadata.key) {
                    case "maxParallel": maxParallel = metadata.value; break;
                    case "absoluteParallels": absoluteParallels = metadata.value; break;
                }
            }
            if (maxParallel > 0 && !seenParallel.has(maxParallel)) {
                seenParallel.add(maxParallel);
                let name = stripFormatting(item.name);
                const suffix = " Parallel Control Hatch";
                if (name.endsWith(suffix))
                    name = name.slice(0, -suffix.length);
                parallel.push({ name, parallels: maxParallel });
            }
            if (absoluteParallels > 0 && !seenAbsolute.has(absoluteParallels)) {
                seenAbsolute.add(absoluteParallels);
                let name = stripFormatting(item.name);
                const suffix = " Absolute Parallel Mastery Hatch";
                if (name.endsWith(suffix))
                    name = name.slice(0, -suffix.length);
                absolute.push({ name, parallels: absoluteParallels });
            }
        }
        parallel.sort((a, b) => a.parallels - b.parallels);
        absolute.sort((a, b) => a.parallels - b.parallels);
        SetParallelHatchTiers(parallel);
        SetAbsoluteParallelHatchTiers(absolute);
    }

    private FillRecipesRemap(remap:Int32Array) {
        for (let i = 0; i < remap.length; i++) {
            let remapPos = remap[i];
            let id = this.GetString(this.elements[remapPos]);
            this.objectPositionMap[id] = this.elements[remapPos+1];
        }
    }

    private FillObjectPositionMap(elements:Int32Array) {
        for (var i=0; i<elements.length; i++) {
            var id = this.GetString(this.elements[elements[i]+4]);
            this.objectPositionMap[id] = elements[i];
        }
    }

    public GetById<T extends SearchableObject>(id:string):T | null
    {
        if (!id)
            return null;
        var idCode = id.charCodeAt(0);
        var type:IMemMappedObjectPrototype<SearchableObject> = idCode == charCodeItem ? Item : idCode == charCodeFluid ? Fluid : idCode == charCodeRecipe ? Recipe : OreDict;
        if (!this.objectPositionMap[id])
            return null;
        return this.GetObject(this.objectPositionMap[id], type) as T;
    }

    public ObjectMatchQueryBits(query:SearchQuery, pointer:number):boolean
    {
        var arr = query.indexBits;
        for (var i=0; i<4; i++) {
            if ((this.elements[pointer+i] & arr[i]) !== arr[i])
                return false;
        }
        return true;
    }

    GetString(pointer:number):string
    {
        if (pointer == -1)
            return null as unknown as string;
        return (this.objects[pointer] as string) ?? (this.objects[pointer] = this.ReadString(pointer))
    }

    private ReadString(pointer:number):string
    {
        var length = this.elements[pointer];
        var begin = pointer * 4 + 4;
        return this.textReader.decode(this.bytes.subarray(begin, begin+length));
    }

    GetSlice(pointer:number):Int32Array
    {
        return (this.objects[pointer] as Int32Array) ?? (this.objects[pointer] = this.ReadSlice(pointer))   
    }

    private ReadSlice(pointer:number):Int32Array
    {
        var length = this.elements[pointer];
        return this.elements.subarray(pointer+1, pointer+1+length);
    }

    GetObject<T extends MemMappedObject>(pointer:number, prototype: IMemMappedObjectPrototype<T>):T
    {
        if (pointer === -1)
            return null as unknown as T;
        return (this.objects[pointer] as T) ?? (this.objects[pointer] = this.ReadObject<T>(pointer, prototype))
    }

    // Reads a Goods object choosing its concrete type (Item or Fluid) from the stored id prefix.
    GetGoods(pointer:number):Goods
    {
        if (pointer === -1)
            return null as unknown as Goods;
        var id = this.GetString(this.elements[pointer + 4]);
        var prototype:IMemMappedObjectPrototype<Goods> = id.charCodeAt(0) == charCodeFluid ? Fluid : Item;
        return this.GetObject(pointer, prototype);
    }

    private ReadObject<T extends MemMappedObject>(pointer:number, prototype:IMemMappedObjectPrototype<T>):T
    {
        return new prototype(this, pointer);
    }

    GetObjectIfMatchingSearch<T extends SearchableObject>(query:SearchQuery | null, pointer:number, prototype:IMemMappedObjectPrototype<T>):T | null
    {
        if (query === null)
            return this.GetObject(pointer, prototype);
        if (!this.ObjectMatchQueryBits(query, pointer))
            return null;
        var inst = this.GetObject(pointer, prototype);
        if (query.original.length === 1)
            return inst;
        return inst.MatchSearchText(query) ? inst : null;
    }

    IsObjectMatchingSearch(obj:SearchableObject, query:SearchQuery | null):boolean
    {
        if (query === null)
            return true;
        if (!this.ObjectMatchQueryBits(query, obj.objectOffset))
            return false;
        if (query.original.length === 1)
            return true;
        return obj.MatchSearchText(query);
    }
}

export interface IMemMappedObjectPrototype<T extends MemMappedObject>
{
    new(repository:Repository, offset:number):T
}

class MemMappedObject
{
    repository:Repository;
    objectOffset:number

    constructor(repository:Repository, offset:number)
    {
        this.repository = repository;
        this.objectOffset = offset;
    }

    protected GetInt(offset:number)
    {
        return this.repository.elements[offset + this.objectOffset];
    }

    protected GetDouble(offset:number)
    {
        return this.repository.view.getFloat64(4 * (offset + this.objectOffset), true);
    }

    protected GetString(offset:number)
    {
        return this.repository.GetString(this.repository.elements[offset + this.objectOffset]);
    }

    protected GetSlice(offset:number)
    {
        return this.repository.GetSlice(this.repository.elements[offset + this.objectOffset]);
    }

    protected GetStringArray(offset:number):string[]
    {
        let slice = this.GetSlice(offset);
        let result:string[] = new Array(slice.length);
        for (var i = 0; i < slice.length; i++) {
            result[i] = this.repository.GetString(slice[i]);
        }
        return result;
    }

    protected GetArray<T extends MemMappedObject>(offset:number, prototype:IMemMappedObjectPrototype<T>)
    {
        let slice = this.GetSlice(offset);
        let result:T[] = new Array(slice.length);
        for (var i = 0; i < slice.length; i++) {
            result[i] = this.repository.GetObject(slice[i], prototype);
        }
        return result;
    }

    protected GetGoodsArray(offset:number):Goods[]
    {
        let slice = this.GetSlice(offset);
        let result:Goods[] = new Array(slice.length);
        for (var i = 0; i < slice.length; i++) {
            result[i] = this.repository.GetGoods(slice[i]);
        }
        return result;
    }

    protected GetObject<T extends MemMappedObject>(offset:number, prototype:IMemMappedObjectPrototype<T>)
    {
        return this.repository.GetObject<T>(this.repository.elements[offset + this.objectOffset], prototype);
    }
}

abstract class SearchableObject extends MemMappedObject
{
    id:string = this.GetString(4);
    // Elements 0-3 are reserved for 128-bit index
    abstract MatchSearchText(query:SearchQuery):boolean;
}

export abstract class RecipeObject extends SearchableObject{}

export abstract class Goods extends RecipeObject
{
    get name(): string {return this.GetString(5);}
    get mod(): string {return this.GetString(6);}
    get internalName(): string {return this.GetString(7);}
    get iconId(): number {return this.GetInt(9);}
    get tooltip(): string | null {return this.GetString(10);}
    get unlocalizedName(): string {return this.GetString(11);}
    get nbt(): string | null {return this.GetString(12);}
    get production(): Int32Array {return this.GetSlice(13);}
    get consumption(): Int32Array {return this.GetSlice(14);}

    abstract get tooltipDebugInfo():string;

    MatchSearchText(query: SearchQuery): boolean {
        if (query.mod !== null && !this.mod.toLowerCase().includes(query.mod)) {
            return false;
        }
        return query.Match(this.name) || query.Match(this.tooltip);
    }
}

export class Item extends Goods
{
    get stackSize():number {return this.GetInt(15);}
    get damage():number {return this.GetInt(16);}
    get container():FluidContainer | null {return this.GetObject(17, FluidContainer);}
    get recipeModifiers():string[] {return this.GetStringArray(18);}
    get metadata():ItemMetadata[] {return this.GetArray(19, ItemMetadata);}

    MetadataByKey(key:string, defaultValue:number = 0):number {
        for (const metadata of this.metadata) {
            if (metadata.key === key) {
                return metadata.value;
            }
        }
        return defaultValue;
    }

    get tooltipDebugInfo(): string {
        var baseInfo = `${this.mod}:${this.internalName}:${this.damage}`;
        var nbt = this.nbt;
        if (nbt != null)
            baseInfo += "\n" + nbt;
        return baseInfo;
    }
}

export class FluidContainer extends MemMappedObject
{
    get fluid():Fluid {return this.GetObject(0, Fluid);}
    get amount():number {return this.GetInt(1);}
    get empty():Item {return this.GetObject(2, Item);}
}

export class Fluid extends Goods
{
    get isGas():boolean {return this.GetInt(15) === 1;}
    get containers():Int32Array {return this.GetSlice(16);}
    get tooltipDebugInfo(): string {
        return `${this.mod}:${this.internalName}`;
    }
}

export class OreDict extends RecipeObject
{
    items:Goods[];

    constructor(repository:Repository, offset:number) {
        super(repository, offset);
        this.items = this.GetGoodsArray(5);
    }

    MatchSearchText(query: SearchQuery): boolean
    {
        var items = this.items;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (this.repository.ObjectMatchQueryBits(query, item.objectOffset) && item.MatchSearchText(query))
                return true;
        }
        return false;
    }
}

export class RecipeType extends MemMappedObject
{
    singleblocks:Item[];
    multiblocks:Item[];
    defaultCrafter:Item;

    constructor(repository:Repository, offset:number) {
        super(repository, offset);
        this.singleblocks = this.GetArray(5, Item);
        this.defaultCrafter = this.GetObject(6, Item);
        this.multiblocks = this.GetArray(3, Item);
    }

    get name():string {return this.GetString(0);}
    get category():string {return this.GetString(1);}
    get dimensions():Int32Array {return this.GetSlice(2);}
    get shapeless():boolean {return this.GetInt(4) === 1;}
}

class GtRecipe extends MemMappedObject
{
    get voltage():number {return this.GetInt(0);}
    get durationTicks():number {return this.GetInt(1);}
    get durationSeconds():number {return this.GetInt(1) / 20;}
    get durationMinutes():number {return this.GetInt(1) / (20 * 60);}
    get amperage():number {return this.GetInt(2);}
    get voltageTier():number {return this.GetInt(3);}
    get metadata():GtRecipeMetadata[] {return this.GetArray(4, GtRecipeMetadata);}
    get circuitConflicts():number {return this.GetInt(5);}

    MetadataByKey(key:string, defaultValue:number = 0):number {
        for (const metadata of this.metadata) {
            if (metadata.key === key) {
                return metadata.value;
            }
        }
        return defaultValue;
    }
}

export class GtRecipeMetadata extends MemMappedObject
{
    get key():string {return this.GetString(0);}
    get value():number {return this.GetDouble(1);}
}

export class ItemMetadata extends MemMappedObject
{
    get key():string {return this.GetString(0);}
    get value():number {return this.GetDouble(1);}
}

export enum RecipeIoType
{
    ItemInput = 0,
    OreDictInput,
    FluidInput,
    FluidOreDictInput,
    ItemOutput,
    FluidOutput
}

export type RecipeInOut =
{
    type: RecipeIoType;
    goodsPtr: number;
    goods: RecipeObject;
    slot: number;
    amount: number;
    probability: number;
    tierChanceBoost: number;
}

const RecipeIoTypePrototypes:IMemMappedObjectPrototype<RecipeObject>[] = [Item, OreDict, Fluid, OreDict, Item, Fluid];

export class Recipe extends SearchableObject
{
    readonly recipeType:RecipeType = this.GetObject(6, RecipeType);
    get gtRecipe():GtRecipe {return this.GetObject(7, GtRecipe)}
    private computedIo:RecipeInOut[] | undefined;

    get items():RecipeInOut[] { return this.computedIo ?? (this.computedIo = this.ComputeItems());}

    private ComputeItems():RecipeInOut[]
    {
        var slice = this.GetSlice(5);
        var elements = slice.length / 6;
        var result:RecipeInOut[] = new Array(elements);
        var index = 0;
        for(var i=0; i<elements; i++) {
            var type:RecipeIoType = slice[index++];
            var ptr = slice[index++];
            result[i] = {
                type:type, 
                goodsPtr: ptr,
                goods:this.repository.GetObject<RecipeObject>(ptr, RecipeIoTypePrototypes[type]),
                slot: slice[index++],
                amount: slice[index++],
                probability: slice[index++] / 10000,
                tierChanceBoost: slice[index++] / 10000,
            }
        }
        return result;
    }

    MatchSearchText(query: SearchQuery): boolean 
    {
        var slice = this.GetSlice(5);
        var count = slice.length / 6;
        for (var i=0; i<count; i++) 
        {
            var pointer = slice[i*6+1];
            if (!this.repository.ObjectMatchQueryBits(query, pointer))
                continue;
            var objType = RecipeIoTypePrototypes[slice[i*6]];
            var obj = this.repository.GetObject<RecipeObject>(pointer, objType);
            if (obj.MatchSearchText(query))
                return true;
        }
        return false;
    }
}