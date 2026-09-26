import { GetSingleRecipeDom } from "./nei.js";
import { Goods, Recipe, RecipeInOut } from "./repository.js";

export var currentTooltipElement:HTMLElement | undefined;
const tooltip = document.getElementById("tooltip")!;
const tooltipHeader = tooltip.querySelector("#tooltip-header") as HTMLElement;
const tooltipDebugInfo = tooltip.querySelector("#tooltip-debug") as HTMLElement;
const tooltipText = tooltip.querySelector("#tooltip-text") as HTMLElement;
const tooltipAction = tooltip.querySelector("#tooltip-action") as HTMLElement;
const tooltipMod = tooltip.querySelector("#tooltip-mod") as HTMLElement;
const tooltipRecipe = tooltip.querySelector("#tooltip-recipe") as HTMLElement;
let tooltipScrollTarget = 0;
let tooltipScrollCache = new Map<HTMLElement, number>();
let tooltipData:TooltipData | undefined;
let shiftHeld = false;

interface TooltipViewState {
    page: number;
    modifier: number;
}

const tooltipViewState = new WeakMap<HTMLElement, TooltipViewState>();

interface TooltipData {
    header?: string;
    text?: string | null;
    action?: string | null;
    goods?: Goods;
    recipe?: Recipe | null;
    overrideIo?: RecipeInOut[];
}

function OnGlobalScroll(ev: WheelEvent) : any {
  if (!tooltip || tooltip.style.display !== "block") return;

  const goods = tooltipData?.goods;
  const state = currentTooltipElement ? GetTooltipViewState(currentTooltipElement) : undefined;
  if (goods && state && ev.deltaY !== 0) {
    if (shiftHeld && goods.modifierSections.length > 0) {
      state.modifier = WrapIndex(state.modifier + Math.sign(ev.deltaY), goods.modifierSections.length);
      RefreshInteractiveTooltip();
      ev.preventDefault();
      return;
    }
    if (ev.ctrlKey && goods.pages.length > 1) {
      state.page = WrapIndex(state.page + Math.sign(ev.deltaY), goods.pages.length);
      RefreshInteractiveTooltip();
      ev.preventDefault();
      return;
    }
  }
  
  // Scroll inside tooltip instead of page
  tooltipScrollTarget += ev.deltaY;
  tooltipScrollTarget = Math.max(0, Math.min(tooltipScrollTarget, tooltip.scrollHeight - tooltip.clientHeight));
  if (tooltip.scrollTop !== tooltipScrollTarget) {
    tooltip.scrollTop = tooltipScrollTarget;
    ev.preventDefault(); // block normal page scroll
  }
}

export function ShowTooltip(target: HTMLElement, data: TooltipData): void {
    if (data == null)
        return;

    const header = data.goods?.name ?? data.header ?? '';
    const debug = data.goods?.tooltipDebugInfo ?? null;
    const text = data.goods?.tooltip ?? data.text ?? null;
    const mod = data.goods?.mod ?? null;
    const action = data.action ?? null;
    const recipe = data.recipe ?? null;
    const overrideIo = data.overrideIo;
    tooltipData = data;
    ShowTooltipRaw(target, header, debug, text, mod, action, recipe, overrideIo);
    target.focus();
    target.addEventListener("mouseleave", () => HideTooltip(target), { once: true });
    if (tooltipScrollCache.has(target)) {
        tooltipScrollTarget = tooltipScrollCache.get(target)!;
    } else {
        tooltipScrollTarget = 0;
    }
 
    // Override smooth scroll for the initial scroll loaded from cache.
    // Otherwise it scrolls visibly every time.
    tooltip.style.scrollBehavior = 'auto';
    tooltipScrollTarget = Math.max(0, Math.min(tooltipScrollTarget, tooltip.scrollHeight - tooltip.clientHeight));
    tooltip.scrollTop = tooltipScrollTarget;
    tooltip.style.scrollBehavior = 'smooth';
    
    window.addEventListener("wheel", OnGlobalScroll, { passive: false });
}

function SetTextOptional(element:HTMLElement, data: string | null, html: boolean)
{
    if (data === undefined || data === null)
        element.style.display = "none";
    else {
        element.style.display = "block";
        if (html)
            element.innerHTML = data;
        else
            element.textContent = data;
    }
}

function ShowTooltipRaw(target:HTMLElement, header:string, debug:string|null, description:string|null, mod:string|null, action:string|null, recipe:Recipe|null, overrideIo?:RecipeInOut[])
{
    tooltip.style.display = "block";
    currentTooltipElement = target;
    SetTextOptional(tooltipHeader, header, true);
    SetTextOptional(tooltipDebugInfo, debug, false);
    SetTextOptional(tooltipText, RenderTooltipText(description, tooltipData?.goods, GetTooltipViewState(target)), true);
    SetTextOptional(tooltipAction, action, false);
    SetTextOptional(tooltipMod, mod, false);

    tooltipRecipe.style.display = "none";
    if (recipe) {
        tooltipRecipe.style.display = "block";
        tooltipRecipe.innerHTML = GetSingleRecipeDom(recipe, overrideIo);
    }

    PositionTooltip(target);
}

function PositionTooltip(target:HTMLElement) {
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const isRightHalf = targetRect.left > window.innerWidth / 2;

    if (isRightHalf) {
        tooltip.style.left = `${targetRect.left - tooltipRect.width}px`;
    } else {
        tooltip.style.left = `${targetRect.right}px`;
    }

    if (targetRect.top + tooltipRect.height > window.innerHeight) {
        tooltip.style.top = `${window.innerHeight - tooltipRect.height}px`;
    } else {
        tooltip.style.top = `${Math.max(targetRect.top, 0)}px`;
    }
}

function GetTooltipViewState(target:HTMLElement):TooltipViewState {
    let state = tooltipViewState.get(target);
    if (!state) {
        state = { page: 0, modifier: 0 };
        tooltipViewState.set(target, state);
    }
    return state;
}

function WrapIndex(value:number, length:number):number {
    return ((value % length) + length) % length;
}

function Separator():string {
    return '<div class="tooltip-separator fmt-8">-----------------------------------</div>';
}

function Lines(lines:string[], className:string = "", trimLeading:boolean = false):string {
    return lines.map(line =>
        `<div class="tooltip-line ${className}">${(trimLeading ? line.replace(/^\s+/, "") : line) || "&nbsp;"}</div>`).join("");
}

function CapabilityPrompt():string {
    return '<div><span class="fmt-6">Hold </span><span class="fmt-d">[SHIFT]</span><span class="fmt-6"> to see capabilities</span></div>';
}

function RenderModifiers(goods:Goods, state:TooltipViewState):string {
    const sections = goods.modifierSections;
    state.modifier = WrapIndex(state.modifier, sections.length);
    let html = Separator() + '<div class="fmt-6">Capabilities:</div>';
    sections.forEach((section, index) => {
        html += `<div>${index === state.modifier ? "[x]" : "[ ]"} ${section.name}</div>`;
        if (index === state.modifier)
            html += Lines(section.description, "tooltip-modifier-description", true);
    });
    return html +
        '<div class="fmt-7"><span class="tooltip-arrow tooltip-arrow-up"></span> ' +
        '<span class="fmt-d">[SHIFT + Scroll UP]</span> | ' +
        '<span class="fmt-d">[SHIFT + Scroll DOWN]</span> ' +
        '<span class="tooltip-arrow tooltip-arrow-down"></span></div>';
}

function RenderPages(goods:Goods, state:TooltipViewState):string {
    const pages = goods.pages;
    state.page = WrapIndex(state.page, pages.length);
    let html = Separator() + Lines(pages[state.page]);
    if (pages.length > 1) {
        html += '<div class="fmt-7"><span class="tooltip-arrow tooltip-arrow-left"></span>' +
            '<span class="fmt-d">[CTRL + Scroll UP]</span> ' +
            `Page ${state.page + 1}/${pages.length} ` +
            '<span class="fmt-d">[CTRL + Scroll DOWN]</span>' +
            '<span class="tooltip-arrow tooltip-arrow-right"></span></div>';
    }
    return html;
}

function RenderTooltipText(description:string|null, goods:Goods|undefined, state:TooltipViewState):string|null {
    if (!goods)
        return description;

    const hasModifiers = goods.modifierSections.length > 0;
    const hasPages = goods.pages.length > 0;
    let html = description ?? "";

    if (shiftHeld && hasModifiers)
        return html + RenderModifiers(goods, state);

    if (hasPages)
        html += RenderPages(goods, state);
    if (hasModifiers)
        html += Separator() + CapabilityPrompt();
    return html;
}

function RefreshInteractiveTooltip():void {
    if (!currentTooltipElement || !tooltipData)
        return;
    const description = tooltipData.goods?.tooltip ?? tooltipData.text ?? null;
    SetTextOptional(
        tooltipText,
        RenderTooltipText(description, tooltipData.goods, GetTooltipViewState(currentTooltipElement)),
        true);
    PositionTooltip(currentTooltipElement);
}

function OnModifierKeyChanged(ev:KeyboardEvent):void {
    if (ev.key !== "Shift" || shiftHeld === ev.shiftKey)
        return;
    shiftHeld = ev.shiftKey;
    RefreshInteractiveTooltip();
}

window.addEventListener("keydown", OnModifierKeyChanged);
window.addEventListener("keyup", OnModifierKeyChanged);
window.addEventListener("blur", () => {
    if (!shiftHeld)
        return;
    shiftHeld = false;
    RefreshInteractiveTooltip();
});

export function HideTooltip(target:HTMLElement)
{
    if (currentTooltipElement !== target)
        return;
    tooltipScrollCache.set(target, tooltipScrollTarget);
    currentTooltipElement = undefined;
    tooltipData = undefined;
    tooltip.style.display = "none";
    window.removeEventListener("wheel", OnGlobalScroll);
}

export function IsHovered(obj:HTMLElement):boolean
{
    return currentTooltipElement === obj;
}