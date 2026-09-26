import { Item, Repository } from '../repository';
import { setupRepository } from './setup';

describe('Exported tooltip data', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    it('preserves default lines and modifier sections', () => {
        const item = Repository.current.GetById<Item>('i:gtceu:multi_smelter:0')!;

        expect(item.tooltip).toBe('Available Recipe Types: Electric Furnace, Alloy Smelter<br>');
        expect(item.modifierSections.map(section => section.name)).toEqual([
            'Multi Smelter Parallel:',
            'Batch Mode:',
        ]);
        expect(item.modifierSections[0].description[0]).toContain(
            '  <span class="fmt-7">Runs recipes in parallel based on the coils used.</span>',
        );
        expect(item.pages).toEqual([]);
    });

    it('preserves paginated tooltip lines and their formatting', () => {
        const item = Repository.current.GetById<Item>('i:start_core:komaru:0')!;

        expect(item.modifierSections).toEqual([]);
        expect(item.pages).toHaveLength(4);
        expect(item.tooltip).toBe('<span class="fmt-6 fmt-l">Modular Gateway of the Heavens</span><br>');
        expect(item.pages[1]).toContain('<span class="fmt-8">-----------------------------------</span>');
        expect(item.pages[1]).toContain('');
        expect(item.pages[1].join('')).toContain('<span class="fmt-b">Modular Overclocking</span>');
    });

    it('preserves pages and modifiers on the same item', () => {
        const item = Repository.current.GetById<Item>('i:start_core:bacterial_hydrocarbon_harvester:0')!;

        expect(item.pages).toHaveLength(1);
        expect(item.tooltip).not.toContain('Added by Star Technology');
        expect(item.tooltip).not.toContain('-----------------------------------');
        expect(item.modifierSections.map(section => section.id)).toEqual([
            'parallel_hatch',
            'batch_mode',
        ]);
    });
});
