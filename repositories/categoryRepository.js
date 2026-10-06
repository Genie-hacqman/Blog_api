import { literal } from "sequelize";
import { Category } from "../database/models/index.js";

// how many published posts are in each section (drafts and unpublished posts are not counted)
const publishedCount = [
    literal("(SELECT COUNT(*) FROM `Posts` WHERE `Posts`.`categoryId` = `Category`.`id` AND `Posts`.`status` = 'published')"),
    "postCount",
];
const attributes = ["id", "name", "slug", "description", publishedCount];

export const listCategories = async () => Category.findAll({ attributes, order: [["name", "ASC"]] });

export const findCategoryBySlug = async (slug) => Category.findOne({ where: { slug }, attributes });

export const findCategoryById = async (id, options = {}) => Category.findByPk(id, options);

export const createCategory = async (data, options = {}) => Category.create(data, options);

export const updateCategoryById = async (id, data, options = {}) => {
    const [count] = await Category.update(data, { where: { id }, ...options });
    return count;
};

export const deleteCategoryById = async (id, options = {}) => Category.destroy({ where: { id }, ...options });

// names are unique without regard to case or accents (the column collation)
export const categoryWithName = async (name, options = {}) => Category.findOne({ where: { name }, attributes: ["id"], ...options });

export const categorySlugExists = async (slug, options = {}) =>
    Boolean(await Category.findOne({ where: { slug }, attributes: ["id"], ...options }));
