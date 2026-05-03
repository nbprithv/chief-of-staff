/**
 * Weeknight Meal Planner skill
 *
 * Runs every Saturday. Flow:
 *   1. Load recipe pool from data/recipes.json
 *   2. Randomly select 5 weeknight dinners:
 *      - 1 random night gets Lemon Caper Salmon Packets + a paired veggie alternative
 *      - The remaining 4 nights get distinct vegetarian recipes
 *   3. Create Google Calendar events Mon–Fri at 5:00 PM with full recipe details
 *   4. Consolidate all ingredients and create a shopping list event on Sunday at 5:00 PM
 */

import { readFileSync } from 'fs';
import { join }         from 'path';
import { createCalendarEvent } from '../../../integrations/google/calendar-write.service.js';
import { logger }               from '../../../core/logger.js';
import type { BackgroundJob }   from '../../../db/schema/background_jobs.schema.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Ingredient {
    name:      string;
    quantity?: string;
    optional:  boolean;
    group?:    string;
}

interface Recipe {
    id:          number;
    slug:        string;
    name:        string;
    tags:        string[];
    mealPlannerPool: boolean;
    timeMinutes: { min: number; max: number };
    soakTimeHours?: { min: number; max: number };
    servings:    { min: number; max: number };
    description: string;
    ingredients:          Ingredient[];
    ingredients_dressing?: Ingredient[];
    ingredients_tadka?:    Ingredient[];
    ingredients_sauce?:    Ingredient[];
    steps: string[];
}

export interface MealPlannerResult {
    status:       'success' | 'skipped' | 'error';
    output?:      string;
    error?:       string;
    inputTokens:  number;
    outputTokens: number;
}

// ── Data loading ──────────────────────────────────────────────────────────────

function loadRecipes(): Recipe[] {
    const filePath = join(process.cwd(), 'data', 'recipes.json');
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as { recipes: Recipe[] };
    return data.recipes;
}

// ── Random helpers ────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function pickNDistinct<T extends { id: number }>(arr: T[], n: number, excludeIds: number[] = []): T[] {
    const pool     = arr.filter(r => !excludeIds.includes(r.id));
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDays(base: Date, n: number): Date {
    const d = new Date(base);
    d.setDate(base.getDate() + n);
    return d;
}

function toDateString(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function toDisplayDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

// ── Ingredient helpers ────────────────────────────────────────────────────────

/** Flatten all ingredient groups from a recipe into one list. */
function flattenIngredients(recipe: Recipe): Ingredient[] {
    return [
        ...recipe.ingredients,
        ...(recipe.ingredients_dressing ?? []).map(i => ({ ...i, name: `[Dressing] ${i.name}` })),
        ...(recipe.ingredients_tadka    ?? []).map(i => ({ ...i, name: `[Tadka] ${i.name}`    })),
        ...(recipe.ingredients_sauce    ?? []).map(i => ({ ...i, name: `[Sauce] ${i.name}`    })),
    ];
}

function fmtIngredient(ing: Ingredient): string {
    const qty = ing.quantity ? `${ing.quantity} ` : '';
    const opt = ing.optional ? ' (optional)' : '';
    return `• ${qty}${ing.name}${opt}`;
}

// ── Recipe description block (for calendar event body) ────────────────────────

function buildRecipeBlock(recipe: Recipe): string {
    const timeStr = recipe.timeMinutes.min === recipe.timeMinutes.max
        ? `${recipe.timeMinutes.min} min`
        : `${recipe.timeMinutes.min}–${recipe.timeMinutes.max} min`;
    const servStr = recipe.servings.min === recipe.servings.max
        ? `${recipe.servings.min} servings`
        : `${recipe.servings.min}–${recipe.servings.max} servings`;

    const lines: string[] = [
        `🍽️ ${recipe.name}`,
        `⏱️ ${timeStr} | 👥 ${servStr}`,
    ];

    if (recipe.soakTimeHours) {
        lines.push(
            `⚠️ Requires ${recipe.soakTimeHours.min}–${recipe.soakTimeHours.max} hrs soaking time — plan ahead!`,
        );
    }

    lines.push('', 'INGREDIENTS');
    lines.push(...flattenIngredients(recipe).map(fmtIngredient));
    lines.push('', 'STEPS');
    lines.push(...recipe.steps.map((s, i) => `${i + 1}. ${s}`));

    return lines.join('\n');
}

// ── Shopping list ─────────────────────────────────────────────────────────────

const CATEGORIES = [
    'Produce',
    'Proteins',
    'Dairy & Eggs',
    'Pantry & Spices',
    'Frozen',
    'Sauces & Condiments',
    'Other',
] as const;

type Category = typeof CATEGORIES[number];

const CAT_ICONS: Record<Category, string> = {
    'Produce':               '🥬',
    'Proteins':              '🥩',
    'Dairy & Eggs':          '🧀',
    'Pantry & Spices':       '🥫',
    'Frozen':                '❄️',
    'Sauces & Condiments':   '🫙',
    'Other':                 '📦',
};

function categorize(rawName: string): Category {
    // Strip group prefixes like "[Dressing] " before matching
    const l = rawName.toLowerCase().replace(/^\[.*?\]\s*/, '');

    if (/\bfrozen\b/.test(l))                                             return 'Frozen';
    if (/\bsalmon\b/.test(l))                                             return 'Proteins';
    if (/\b(cheese|feta|mozzarella|parmesan|ghee|butter|dahi|yogurt|cream)\b/.test(l)
        || /\begg(s)?\b/.test(l))                                         return 'Dairy & Eggs';
    if (/\b(tofu|chickpea|chana|lentil|edamame|quinoa|urad|bean|dal)\b/.test(l))
                                                                           return 'Proteins';
    if (/enchilada sauce|thai curry sauce|oyster sauce|dark soy|tamari|chili (oil|crunch)|rice vinegar|tahini|miso|curry sauce/.test(l))
                                                                           return 'Sauces & Condiments';
    if (/\b(spinach|palak|kale|cabbage|onion|shallot|scallion|green onion|bell pepper|pepper|garlic|ginger|tomato|zucchini|courgette|eggplant|aubergine|carrot|asparagus|cucumber|avocado|potato|sweet potato|basil|parsley|cilantro|coriander|dill|mint|mushroom|cauliflower|broccoli|lemon|lime|herb|butternut|squash|sage|rosemary|pea|leek|nut|pecan|pistachio)\b/.test(l))
                                                                           return 'Produce';
    if (/\b(oil|salt|pepper|cumin|coriander powder|turmeric|chili powder|chilli|oregano|paprika|za.atar|garam|masala|methi|jeera|dhania|powder|spice|baking|flour|sugar|maple|honey|pasta|rice|noodle|tortilla|bread|pita|canned|tomato paste|broth|peanut|coconut|caper|olive|sesame|soy sauce|vinegar|water)\b/.test(l))
                                                                           return 'Pantry & Spices';
    return 'Other';
}

function buildShoppingList(
    recipes:   Recipe[],
    weekLabel: string,
    mealLines: string[],
): string {
    // Aggregate: key = lowercased display name, value = { displayName, count }
    const buckets = new Map<Category, Map<string, { displayName: string; count: number }>>(
        CATEGORIES.map(c => [c, new Map()]),
    );

    for (const recipe of recipes) {
        for (const ing of flattenIngredients(recipe)) {
            // Clean display name: strip group prefix
            const display = ing.name.replace(/^\[.*?\]\s*/, '').trim();
            const key     = display.toLowerCase();
            const cat     = categorize(ing.name);
            const bucket  = buckets.get(cat)!;
            const entry   = bucket.get(key);
            if (entry) {
                entry.count++;
            } else {
                bucket.set(key, { displayName: display, count: 1 });
            }
        }
    }

    const lines: string[] = [
        '🛒 WEEKLY SHOPPING LIST',
        `Week of ${weekLabel}`,
        '',
    ];

    for (const cat of CATEGORIES) {
        const bucket = buckets.get(cat)!;
        if (bucket.size === 0) continue;
        lines.push(`${CAT_ICONS[cat]} ${cat.toUpperCase()}`);
        for (const { displayName, count } of bucket.values()) {
            const note = count > 1 ? ` (x${count})` : '';
            lines.push(`• ${displayName}${note}`);
        }
        lines.push('');
    }

    lines.push('Meals this week:');
    lines.push(...mealLines);

    return lines.join('\n');
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runWeeklyMealPlanner(job: BackgroundJob): Promise<MealPlannerResult> {
    const userId = job.user_id;
    const today  = new Date();

    // ── Load recipes ─────────────────────────────────────────────────────────
    let allRecipes: Recipe[];
    try {
        allRecipes = loadRecipes();
    } catch (err: any) {
        logger.error('[meal-planner] failed to load recipes.json', { error: err?.message });
        return { status: 'error', error: `Failed to load recipes: ${err?.message}`, inputTokens: 0, outputTokens: 0 };
    }

    const vegPool      = allRecipes.filter(r => r.mealPlannerPool && !r.tags.includes('salmon'));
    const salmonRecipe = allRecipes.find(r => r.tags.includes('salmon') && r.mealPlannerPool);

    if (!salmonRecipe) {
        return { status: 'error', error: 'Salmon recipe not found in recipes.json', inputTokens: 0, outputTokens: 0 };
    }
    if (vegPool.length < 5) {
        return { status: 'error', error: `Not enough veggie recipes in pool (found ${vegPool.length}, need 5)`, inputTokens: 0, outputTokens: 0 };
    }

    // ── Step 1: Select meals ─────────────────────────────────────────────────
    const salmonNight  = Math.floor(Math.random() * 5);  // 0=Mon … 4=Fri
    const pairedVeggie = pickRandom(vegPool);
    const otherVeggies = pickNDistinct(vegPool, 4, [pairedVeggie.id]);

    // Build 5-night lineup indexed Mon=0 … Fri=4
    const lineup: Array<{ recipe: Recipe; altRecipe?: Recipe }> = [];
    let otherIdx = 0;
    for (let i = 0; i < 5; i++) {
        if (i === salmonNight) {
            lineup.push({ recipe: salmonRecipe, altRecipe: pairedVeggie });
        } else {
            lineup.push({ recipe: otherVeggies[otherIdx++] });
        }
    }

    // ── Step 2: Calculate dates (run is Saturday → +1 = Sunday, +2 = Monday …) ──
    const sundayDate = addDays(today, 1);
    const weekDays   = [
        addDays(today, 2), // Monday
        addDays(today, 3), // Tuesday
        addDays(today, 4), // Wednesday
        addDays(today, 5), // Thursday
        addDays(today, 6), // Friday
    ];
    const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const weekLabel = `${toDisplayDate(weekDays[0])} – ${toDisplayDate(weekDays[4])}`;

    // ── Step 3: Create weeknight calendar events ──────────────────────────────
    const errors:  string[] = [];
    const created: string[] = [];

    for (let i = 0; i < 5; i++) {
        const night   = lineup[i];
        const date    = toDateString(weekDays[i]);
        const dayName = WEEKDAY_NAMES[i];

        const title = night.altRecipe
            ? `Dinner: ${night.recipe.name} + ${night.altRecipe.name}`
            : `Dinner: ${night.recipe.name}`;

        const description = night.altRecipe
            ? [
                buildRecipeBlock(night.recipe),
                '',
                '─────────────────────────────────────────',
                `🥦 VEGETARIAN ALTERNATIVE: ${night.altRecipe.name}`,
                '',
                buildRecipeBlock(night.altRecipe),
              ].join('\n')
            : buildRecipeBlock(night.recipe);

        try {
            await createCalendarEvent(userId, {
                title,
                description,
                date,
                start_time: '17:00',
                end_time:   '17:30',
            });
            created.push(`${dayName}: ${title}`);
            logger.info('[meal-planner] created dinner event', { title, date });
        } catch (err: any) {
            const msg = err?.message ?? String(err);
            errors.push(`${dayName} event: ${msg}`);
            logger.error('[meal-planner] failed to create dinner event', { title, date, error: msg });
        }
    }

    // ── Step 4: Build and create shopping list event ──────────────────────────
    // All 6 recipes: 5 weeknight mains (including salmon) + the paired veggie alt
    const shoppingRecipes = [
        ...lineup.map(n => n.recipe),
        ...lineup.filter(n => n.altRecipe).map(n => n.altRecipe!),
    ];

    const mealLines = WEEKDAY_NAMES.map((day, i) => {
        const n = lineup[i];
        return n.altRecipe
            ? `• ${day}: ${n.recipe.name} + ${n.altRecipe.name} (veggie alt)`
            : `• ${day}: ${n.recipe.name}`;
    });

    const shoppingListText = buildShoppingList(shoppingRecipes, weekLabel, mealLines);

    try {
        await createCalendarEvent(userId, {
            title:       '🛒 Weekly Shopping List',
            description: shoppingListText,
            date:        toDateString(sundayDate),
            start_time:  '17:00',
            end_time:    '18:00',
        });
        created.push('Sunday: 🛒 Weekly Shopping List');
        logger.info('[meal-planner] created shopping list event', { date: toDateString(sundayDate) });
    } catch (err: any) {
        const msg = err?.message ?? String(err);
        errors.push(`Shopping list event: ${msg}`);
        logger.error('[meal-planner] failed to create shopping list event', { error: msg });
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const summary = [
        `Meal plan for week of ${weekLabel}.`,
        `Created ${created.length} calendar event${created.length !== 1 ? 's' : ''}.`,
        `Meals: ${mealLines.map(l => l.replace('• ', '')).join(', ')}.`,
        errors.length > 0 ? `Errors: ${errors.join('; ')}` : null,
    ].filter(Boolean).join(' ');

    const status = errors.length > 0 && created.length === 0 ? 'error' : 'success';

    return {
        status,
        output:       summary,
        inputTokens:  0,
        outputTokens: 0,
        ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
    };
}
