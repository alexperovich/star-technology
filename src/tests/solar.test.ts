import { PageModel, RecipeModel } from '../page';
import { SolvePage } from '../solver';
import { Item, Recipe, RecipeIoType, Repository } from '../repository';
import { setupRepository } from './setup';

// The "Solar Power" recipe type is synthesized by the exporter: one generator
// recipe per solar cell (negative voltage = production), run by the solar
// panel/array multiblocks. Each cell outputs its rated EU/t while exposed to the
// sun but must idle to stay heat-neutral, so the sustained output is scaled by
// the duty cycle s = 1 / (1 + heatBuildup * hm / 0.1).
const CELLS = [
    { id: 'r:startcalc:solar_power/ev_solar_cell',  goods: 'i:start_core:ev_solar_cell:0',  voltageOut: 512,    hm: 1.00, tier: 2 },
    { id: 'r:startcalc:solar_power/iv_solar_cell',  goods: 'i:start_core:iv_solar_cell:0',  voltageOut: 2048,   hm: 0.95, tier: 3 },
    { id: 'r:startcalc:solar_power/luv_solar_cell', goods: 'i:start_core:luv_solar_cell:0', voltageOut: 8192,   hm: 0.90, tier: 4 },
    { id: 'r:startcalc:solar_power/zpm_solar_cell', goods: 'i:start_core:zpm_solar_cell:0', voltageOut: 32768,  hm: 0.85, tier: 5 },
    { id: 'r:startcalc:solar_power/uv_solar_cell',  goods: 'i:start_core:uv_solar_cell:0',  voltageOut: 131072, hm: 0.80, tier: 6 },
    { id: 'r:startcalc:solar_power/uhv_solar_cell', goods: 'i:start_core:uhv_solar_cell:0', voltageOut: 524288, hm: 0.75, tier: 7 },
];

const CRAFTERS = [
    { id: 'i:start_core:ev_solar_panel:0',  cells: 9,   voltMult: 1.0,  isArray: false },
    { id: 'i:start_core:iv_solar_panel:0',  cells: 15,  voltMult: 1.05, isArray: false },
    { id: 'i:start_core:luv_solar_panel:0', cells: 21,  voltMult: 1.1,  isArray: false },
    { id: 'i:start_core:uv_solar_array:0',  cells: 64,  voltMult: 1.2,  voltMultCooled: 1.328, isArray: true },
    { id: 'i:start_core:uhv_solar_array:0', cells: 188, voltMult: 1.25, voltMultCooled: 1.45,  isArray: true },
];

const EV = CELLS[0];

const dutyCycle = (hm: number, cooled: boolean) => 1 / (1 + (cooled ? 0.18 : 0.2) * hm / 0.1);

function solveSolar(recipeId: string, crafterId: string, choices: { [k: string]: number } = {}): RecipeModel {
    const page = new PageModel({
        name: 'Solar Test',
        products: [],
        rootGroup: {
            type: 'recipe_group',
            links: {},
            elements: [{
                type: 'recipe',
                recipeId,
                voltageTier: 0,
                fixedCrafterCount: 1,
                crafter: crafterId,
                choices,
            }],
        },
    });
    SolvePage(page);
    return page.rootGroup.elements[0] as RecipeModel;
}

// The dynamo-hatch output tier is user-selectable, so energy is reported under
// whichever tier the page requests; sum across tiers to get the sustained total.
const totalEnergy = (model: RecipeModel) =>
    Object.values(model.flow.energy).reduce((a, b) => a + b, 0);

describe('Solar Power', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    it('synthesizes a generator recipe for every solar cell', () => {
        for (const cell of CELLS) {
            const recipe = Repository.current.GetById<Recipe>(cell.id);
            expect(recipe).toBeTruthy();
            expect(recipe!.recipeType.name).toBe('Solar Power');
            // Negative voltage marks the recipe as an energy producer.
            expect(recipe!.gtRecipe.voltage).toBe(-cell.voltageOut);
            expect(recipe!.gtRecipe.voltageTier).toBe(cell.tier);
            expect(recipe!.gtRecipe.durationTicks).toBe(1024 * 120);
            expect(recipe!.gtRecipe.MetadataByKey('solar_heating_modifier', -1)).toBeCloseTo(cell.hm, 5);
            // Exactly one input: the solar cell.
            const inputs = recipe!.items.filter((s) => s.type === RecipeIoType.ItemInput);
            expect(inputs.length).toBe(1);
            expect(inputs[0].goods.id).toBe(cell.goods);
        }
    });

    it('stores each multiblock cell count read from multiblock_info', () => {
        for (const c of CRAFTERS) {
            const item = Repository.current.GetById<Item>(c.id);
            expect(item).toBeTruthy();
            expect(item!.MetadataByKey('solarCellCount', -1)).toBe(c.cells);
        }
    });

    it('runs one recipe per cell and produces the sustained average output', () => {
        const s = dutyCycle(EV.hm, false);
        for (const c of CRAFTERS) {
            const model = solveSolar(EV.id, c.id);

            // The cell count is the fixed parallel count.
            expect(model.parallels).toBe(c.cells);
            // powerFactor carries the panel's voltage multiplier; the duty cycle
            // lives in the speed/overclock factor.
            expect(model.powerFactor).toBeCloseTo(c.voltMult, 5);
            expect(model.overclockFactor).toBeCloseTo(s * c.cells, 5);

            // Average produced power (negative energy = production), for one crafter.
            const energy = totalEnergy(model);
            expect(energy).toBeCloseTo(-EV.voltageOut * c.cells * c.voltMult * s, 1);
            expect(energy).toBeLessThan(0);

            // The solar cell is consumed over time.
            expect(model.flow.input[EV.goods]).toBeGreaterThan(0);
        }
    });

    it('lets array cooling raise output while panels ignore it', () => {
        const array = CRAFTERS.find((c) => c.isArray)!;
        const off = solveSolar(EV.id, array.id, { solarCooling: 0 });
        const on = solveSolar(EV.id, array.id, { solarCooling: 1 });

        expect(off.powerFactor).toBeCloseTo(array.voltMult, 5);
        expect(on.powerFactor).toBeCloseTo(array.voltMultCooled!, 5);

        const energyOff = totalEnergy(off);
        const energyOn = totalEnergy(on);
        expect(energyOff).toBeCloseTo(-EV.voltageOut * array.cells * array.voltMult * dutyCycle(EV.hm, false), 1);
        expect(energyOn).toBeCloseTo(-EV.voltageOut * array.cells * array.voltMultCooled! * dutyCycle(EV.hm, true), 1);
        // Cooling is strictly better: it raises both the multiplier and the duty cycle.
        expect(Math.abs(energyOn)).toBeGreaterThan(Math.abs(energyOff));

        // Panels have no cooling toggle, so the choice is a no-op.
        const panel = CRAFTERS.find((c) => !c.isArray)!;
        const panelOff = solveSolar(EV.id, panel.id, { solarCooling: 0 });
        const panelOn = solveSolar(EV.id, panel.id, { solarCooling: 1 });
        expect(panelOn.powerFactor).toBeCloseTo(panelOff.powerFactor, 5);
        expect(totalEnergy(panelOn)).toBeCloseTo(totalEnergy(panelOff), 5);
    });

    it('conserves total EU per cell regardless of heat management', () => {
        // Total EU over a cell's life = VoltageOut * voltMult * productiveTicks, so the
        // energy-per-cell-consumed (average power / cell burn rate) is independent of the
        // duty cycle. Cooling changes only the multiplier, not the productive lifetime.
        const array = CRAFTERS.find((c) => c.isArray)!;
        const off = solveSolar(EV.id, array.id, { solarCooling: 0 });
        const euPerCell = (m: RecipeModel) => Math.abs(totalEnergy(m)) / m.flow.input[EV.goods];
        // productiveTicks = durability * cycleTicks = 1024 * 120; per minute = /1200.
        const expectedPerCell = EV.voltageOut * array.voltMult * (1024 * 120 / 1200);
        expect(euPerCell(off)).toBeCloseTo(expectedPerCell, 2);
    });
});
