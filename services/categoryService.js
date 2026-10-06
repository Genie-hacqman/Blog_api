import { randomUUID } from "node:crypto";
import {
    categorySlugExists,
    categoryWithName,
    createCategory,
    deleteCategoryById,
    findCategoryById,
    findCategoryBySlug,
    listCategories,
    updateCategoryById,
} from "../repositories/categoryRepository.js";
import { withTransaction } from "../database/transaction.js";
import { recordAudit } from "./auditService.js";
import { slugify, withSuffix } from "../utils/slug.js";
import { tidyName } from "../utils/taxonomy.js";
import { ConflictError, NotFoundError } from "../utils/AppError.js";

const toCategory = (category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description ?? null,
    // the list and by-slug queries carry a published-post count; a plain object (after an edit) does not
    ...(category.get?.("postCount") !== undefined && { postCount: Number(category.get("postCount")) }),
});

export const getCategories = async () => (await listCategories()).map(toCategory);

export const getCategory = async (slug) => {
    const category = await findCategoryBySlug(slug);
    if (!category) throw new NotFoundError("Category not found");
    return toCategory(category);
};

const nameTaken = () => new ConflictError("A category with that name already exists");

// the first free "technology", "technology-2", ... (the slug is the public address)
const freeSlug = async (name, options) => {
    const base = slugify(name);
    for (let attempt = 1; attempt <= 50; attempt += 1) {
        const candidate = withSuffix(base, attempt);
        if (!(await categorySlugExists(candidate, options))) return candidate;
    }
    return `${base}-${randomUUID().slice(0, 6)}`;
};

export const createNewCategory = async (actor, { name, description }, context) => {
    const clean = tidyName(name);
    return withTransaction(async (transaction) => {
        if (await categoryWithName(clean, { transaction })) throw nameTaken();
        const category = await createCategory({ name: clean, description: description ?? null, slug: await freeSlug(clean, { transaction }) }, { transaction });
        await recordAudit(
            { actorId: actor.id, action: "category.created", entityType: "category", entityId: category.id, metadata: { name: clean } },
            { context, transaction },
        );
        return toCategory(category);
    });
};

// Rename or re-describe. The slug does not follow the name, so existing links keep working.
export const updateExistingCategory = async (actor, id, changes, context) =>
    withTransaction(async (transaction) => {
        const category = await findCategoryById(id, { transaction });
        if (!category) throw new NotFoundError("Category not found");

        const data = {};
        if (changes.name !== undefined) {
            const clean = tidyName(changes.name);
            const clash = await categoryWithName(clean, { transaction });
            if (clash && clash.id !== category.id) throw nameTaken();
            data.name = clean;
        }
        if (changes.description !== undefined) data.description = changes.description;

        if (Object.keys(data).length > 0) {
            await updateCategoryById(category.id, data, { transaction });
            await recordAudit(
                {
                    actorId: actor.id,
                    action: "category.updated",
                    entityType: "category",
                    entityId: category.id,
                    metadata: { ...(data.name !== undefined && { from: category.name, to: data.name }), ...(data.description !== undefined && { descriptionChanged: true }) },
                },
                { context, transaction },
            );
        }
        return toCategory({ ...category.get(), ...data });
    });

// Posts in the category become uncategorized (the database sets their categoryId to NULL); none are deleted.
export const deleteExistingCategory = async (actor, id, context) => {
    await withTransaction(async (transaction) => {
        const category = await findCategoryById(id, { transaction });
        if (!category) throw new NotFoundError("Category not found");

        await deleteCategoryById(category.id, { transaction });
        await recordAudit(
            { actorId: actor.id, action: "category.deleted", entityType: "category", entityId: category.id, metadata: { name: category.name } },
            { context, transaction },
        );
    });
};

// does this category exist? (used to validate the category chosen for a post)
export const categoryExists = async (id) => Boolean(await findCategoryById(id));
