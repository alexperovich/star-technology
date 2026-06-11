import { Repository, Item, Fluid, Recipe, OreDict } from '../repository';
import { setupRepository } from './setup';

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
}); 