var scrollbarWidth:number | undefined;

export function GetScrollbarWidth()
{
    if (scrollbarWidth === undefined) {
        // Create the measurement node
        var scrollDiv = document.createElement("div");
        scrollDiv.className = "scrollbar-measure";
        document.body.appendChild(scrollDiv);

        // Get the scrollbar width
        scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth;

        // Delete the DIV 
        document.body.removeChild(scrollDiv);
        console.log("Scrollbar width: "+scrollbarWidth);
    }
    return scrollbarWidth;
}

export type GtVoltageTier = {
    name:string;
    voltage:number;
}

export function getFusionTierByStartupCost(euToStart:number):number {
    if (euToStart < 10_000_000 * 16)
        return 1;
    else if (euToStart < 20_000_000 * 16)
        return 2;
    else if (euToStart < 40_000_000 * 16)
        return 3;
    else if (euToStart < 320_000_000 * 16)
        return 4;
    else if (euToStart < 1_280_000_000 * 16)
        return 5;
    else
        throw RangeError("Fusion startup cost is too high.");
}

export var voltageTier:GtVoltageTier[] = [
    {name: "LV", voltage: 32},
    {name: "MV", voltage: 128},
    {name: "HV", voltage: 512},
    {name: "EV", voltage: 2048},
    {name: "IV", voltage: 8192},
    {name: "LuV", voltage: 32768},
    {name: "ZPM", voltage: 131072},
    {name: "UV", voltage: 524288},
    {name: "UHV", voltage: 2097152},
    {name: "UEV", voltage: 8388608},
    {name: "UIV", voltage: 33554432},
    {name: "UXV", voltage: 134217728},
    {name: "OpV", voltage: 536870912},
    {name: "MAX", voltage: 2147483640},
    {name: "MAX+1", voltage: 2147483640*Math.pow(4, 1)},
    {name: "MAX+2", voltage: 2147483640*Math.pow(4, 2)},
    {name: "MAX+3", voltage: 2147483640*Math.pow(4, 3)},
    {name: "MAX+4", voltage: 2147483640*Math.pow(4, 4)},
    {name: "MAX+5", voltage: 2147483640*Math.pow(4, 5)},
    {name: "MAX+6", voltage: 2147483640*Math.pow(4, 6)},
    {name: "MAX+7", voltage: 2147483640*Math.pow(4, 7)},
    {name: "MAX+8", voltage: 2147483640*Math.pow(4, 8)},
    {name: "MAX+9", voltage: 2147483640*Math.pow(4, 9)},
    {name: "MAX+10", voltage: 2147483640*Math.pow(4, 10)},
    {name: "MAX+11", voltage: 2147483640*Math.pow(4, 11)},
  ];

export const TIER_LV = 0;
export const TIER_MV = 1;
export const TIER_HV = 2;
export const TIER_EV = 3;
export const TIER_IV = 4;
export const TIER_LUV = 5;
export const TIER_ZPM = 6;    
export const TIER_UV = 7;
export const TIER_UHV = 8;
export const TIER_UEV = 9;
export const TIER_UIV = 10;
export const TIER_UXV = 11;
export const TIER_OpV = 12;
export const TIER_MAX = 13;

// Fallback names; overwritten at load time from the exported coil items (see Repository.LoadCoilTiers).
export var CoilTierNames = ["Cupronickel", "Kanthal", "Nichrome", "TPV", "HSS-G", "HSS-S", "Naquadah", "Naquadah Alloy", "Trinium", "Electrum Flux", "Awakened Draconium", "Infinity", "Hypogen", "Eternal"];

export type CoilTier = {
    name: string;
    baseHeatCapacity: number;
    smelterLevel: number;
    energyDiscount: number;
};

// Fallback coil data; overwritten at load time from the exported coil items (see Repository.LoadCoilTiers).
export var CoilTiers: CoilTier[] = CoilTierNames.map((name, index) => ({
    name,
    baseHeatCapacity: 1801 + index * 900,
    smelterLevel: index + 1,
    energyDiscount: index + 1,
}));

export function SetCoilTierNames(names:string[]) {
    if (names.length > 0)
        CoilTierNames = names;
}

export function SetCoilTiers(tiers:CoilTier[]) {
    if (tiers.length > 0) {
        CoilTiers = tiers;
        CoilTierNames = tiers.map(t => t.name);
    }
}

// Strips formatting from an exported display name: Minecraft color codes
// (§ followed by one character) and the HTML <span class="fmt-..."> wrappers the
// exporter emits for coloured names.
export function stripFormatting(text:string):string {
    return text.replace(/<[^>]*>/g, "").replace(/\u00a7./g, "").trim();
}

// --- Turbine rotor holders & rotors ---
// Populated at load time from the exported items (see Repository.LoadRotorHolders /
// LoadTurbineRotors). The rotor holder's tier and the rotor material's efficiency/power
// drive the production of the rotor-based turbine generators.
export type RotorHolderTier = {
    name: string;
    tier: number;
    maxSpeed: number;
};

export type TurbineRotor = {
    name: string;
    efficiency: number;
    power: number;
};

// Fallback data; overwritten at load time from the exported items.
export var RotorHolderTiers: RotorHolderTier[] = [
    { name: "HV", tier: 3, maxSpeed: 5000 },
    { name: "EV", tier: 4, maxSpeed: 6000 },
    { name: "IV", tier: 5, maxSpeed: 7000 },
    { name: "LuV", tier: 6, maxSpeed: 8000 },
    { name: "ZPM", tier: 7, maxSpeed: 9000 },
    { name: "UV", tier: 8, maxSpeed: 10000 },
    { name: "UHV", tier: 9, maxSpeed: 11000 },
    { name: "UEV", tier: 10, maxSpeed: 12000 },
    { name: "UIV", tier: 11, maxSpeed: 13000 },
];

export var TurbineRotors: TurbineRotor[] = [
    { name: "Iron", efficiency: 115, power: 115 },
];

export function SetRotorHolders(holders:RotorHolderTier[]) {
    if (holders.length > 0)
        RotorHolderTiers = holders;
}

export function SetTurbineRotors(rotors:TurbineRotor[]) {
    if (rotors.length > 0)
        TurbineRotors = rotors;
}

// --- Neutron reflector casings ---
// Populated at load time from the exported *_reflector_casing items (see
// Repository.LoadReflectorTiers). The tier is parsed from the item tooltip
// ("Tier T<n>"), not from metadata.
export type ReflectorTier = {
    name: string;
    tier: number;
};

// Fallback data; overwritten at load time from the exported items.
export var ReflectorTiers: ReflectorTier[] = [
    { name: "Basic", tier: 1 },
    { name: "Advanced", tier: 2 },
    { name: "Complex", tier: 3 },
    { name: "Reinforced", tier: 4 },
    { name: "Borealic", tier: 5 },
    { name: "Dragonic", tier: 6 },
    { name: "Prismalic", tier: 7 },
];

export function SetReflectorTiers(tiers:ReflectorTier[]) {
    if (tiers.length > 0)
        ReflectorTiers = tiers;
}

// --- Parallel hatches ---
// Populated at load time from the exported parallel-hatch items (see
// Repository.LoadParallelHatches). Parallel Control Hatches carry a `maxParallel`
// metadata value; Absolute Parallel Mastery Hatches carry `absoluteParallels`
// (their parallels run without extra energy cost).
export type ParallelHatchTier = {
    name: string;
    parallels: number;
};

// Fallback data; overwritten at load time from the exported items.
export var ParallelHatchTiers: ParallelHatchTier[] = [
    { name: "Elite", parallels: 4 },
    { name: "Master", parallels: 16 },
    { name: "Ultimate", parallels: 64 },
    { name: "Super", parallels: 256 },
    { name: "Epic", parallels: 1024 },
    { name: "Mega", parallels: 4096 },
    { name: "Hyper", parallels: 16384 },
];

export var AbsoluteParallelHatchTiers: ParallelHatchTier[] = [
    { name: "Epic", parallels: 4 },
    { name: "Mega", parallels: 8 },
    { name: "Hyper", parallels: 16 },
];

export function SetParallelHatchTiers(tiers:ParallelHatchTier[]) {
    if (tiers.length > 0)
        ParallelHatchTiers = tiers;
}

export function SetAbsoluteParallelHatchTiers(tiers:ParallelHatchTier[]) {
    if (tiers.length > 0)
        AbsoluteParallelHatchTiers = tiers;
}

// --- Hell Forge heating fluids ---
// The Hell Forge (and Fornax's Infernal Rotary Engine) consume a heating fluid
// to heat their crucible. Each fluid can heat the crucible to a maximum
// temperature (in MK). For every 450MK the fluid's temperature exceeds the
// recipe's required temperature (the recipe's ebf_temp, also in MK), the recipe
// gains a multiplicative x2 of free (absolute) parallels.
export type HeatingFluid = {
    id: string;
    name: string;
    temperature: number;    // maximum crucible temperature in MK
};

export var HeatingFluids: HeatingFluid[] = [
    { id: "start_core:flamewake_solvent", name: "Flamewake Solvent", temperature: 900 },
    { id: "start_core:cinderbrew_solvent", name: "Cinderbrew Solvent", temperature: 1350 },
    { id: "start_core:emberheart_nectar", name: "Emberheart Nectar", temperature: 1800 },
    { id: "start_core:corefire_nectar", name: "Corefire Nectar", temperature: 2250 },
    { id: "start_core:igniferous_elixir", name: "Igniferous Elixir", temperature: 2700 },
    { id: "start_core:infernum_elixir", name: "Infernum Elixir", temperature: 3150 },
    { id: "start_core:blazing_phlogiston", name: "Blazing Phlogiston", temperature: 3600 },
    { id: "start_core:hellfire_essence", name: "Hellfire Essence", temperature: 4050 },
];


export function formatAmount(amount: number): string {
    if (amount < 0.001) {
        if (amount === 0)
            return "0";
        if (amount < 0)
            return "-" + formatAmount(-amount);
        return "<0.001";
    }
    
    let suffix = '';
    let divisor = 1;
    
    if (amount >= 1e16) {
        suffix = 'P';
        divisor = 1e15;
    } else if (amount >= 1e13) {
        suffix = 'T';
        divisor = 1e12;
    } else if (amount >= 1e10) {
        suffix = 'G';
        divisor = 1e9;
    } else if (amount >= 1e7) {
        suffix = 'M';
        divisor = 1e6;
    } else if (amount >= 1e5) {
        suffix = 'K';
        divisor = 1000;
    }

    const dividedAmount = amount / divisor;
    const maxLength = 6 - suffix.length;
    const integerPart = Math.floor(dividedAmount).toString();
    const availableDecimals = Math.max(0, maxLength - integerPart.length - 1); // -1 for decimal point
    const div = Math.pow(10, availableDecimals);
    
    return (Math.round(dividedAmount * div) / div).toString() + suffix;
}

export function formatTicksAsTime(ticks:number): string {
    const ticksInSecond = 20;
    const ticksInMinute = ticksInSecond * 60;
    const ticksInHour = ticksInMinute * 60;

    const hours = Math.floor(ticks / ticksInHour);
    ticks -= hours * ticksInHour;

    const minutes = Math.floor(ticks / ticksInMinute);
    ticks -= minutes * ticksInMinute;

    const seconds = Math.floor(ticks / ticksInSecond);
    ticks -= seconds * ticksInSecond;

    ticks = Math.ceil(ticks);

    let result = "";

    if (hours > 0)
        result += hours.toString() + "h";
    if (minutes > 0 || result != "")
        result += minutes.toString().padStart(2, "0") + "m";
    if (seconds > 0 || result != "")
        result += seconds.toString().padStart(2, "0") + "s";
    if (ticks > 0 || result != "")
        result += ticks.toString().padStart(2, "0") + "t";

    return result;
}