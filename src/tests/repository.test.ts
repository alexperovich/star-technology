import { Repository, Item, Fluid, Recipe, OreDict } from '../repository';
import { setupRepository } from './setup';
import { AbsoluteParallelHatchTiers, ParallelHatchTiers } from '../utils';

describe('Repository', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    it('should load repository data', () => {
        expect(Repository.current).toBeDefined();
    });

    it('should find items by id', () => {
        const item = Repository.current.GetById<Item>('i:gtceu:electric_blast_furnace:0');
        expect(item).toBeDefined();
        expect(item?.name).toBe('Electric Blast Furnace [EBF]');
    });

    it('should find fluids by id', () => {
        const fluid = Repository.current.GetById<Fluid>('f:gtceu:steam');
        expect(fluid).toBeDefined();
        expect(fluid?.name).toBe('Steam');
    });

    it('keeps absolute parallel hatches out of the normal parallel hatch list', () => {
        expect(ParallelHatchTiers.some((tier) => tier.name.includes('Absolute'))).toBe(false);
        expect(AbsoluteParallelHatchTiers.some((tier) => tier.name === 'Epic' && tier.parallels === 4)).toBe(true);
    });
}); 