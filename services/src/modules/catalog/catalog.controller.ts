import { type RequestHandler } from 'express';
import { emptySchema } from '../../common/validation.js';
import { CrudController } from '../../http/crud.js';
import { getGuestContext } from '../../middleware/guest-auth.js';
import {
  categoryFilterSchema,
  createCategorySchema,
  createServiceItemSchema,
  serviceItemFilterSchema,
  updateCategorySchema,
  updateServiceItemSchema,
} from './catalog.schemas.js';
import { type CategoryService } from './category.service.js';
import { type ServiceItemService } from './service-item.service.js';

// Categories and services are standard resources; patients get their own view.
export class CatalogController {
  public readonly categories;
  public readonly services;

  public constructor(
    categories: CategoryService,
    private readonly serviceItems: ServiceItemService,
  ) {
    this.categories = new CrudController(
      categories,
      { singular: 'serviceCategory', plural: 'serviceCategories' },
      { filter: categoryFilterSchema, create: createCategorySchema, update: updateCategorySchema },
    );
    this.services = new CrudController(
      serviceItems,
      { singular: 'service', plural: 'services' },
      {
        filter: serviceItemFilterSchema,
        create: createServiceItemSchema,
        update: updateServiceItemSchema,
      },
    );
  }

  // The service buttons a patient sees for their bed's hospital.
  public readonly patientCatalog: RequestHandler = async (request, response) => {
    emptySchema.parse(request.query);
    response
      .status(200)
      .json({ categories: await this.serviceItems.catalogFor(getGuestContext(request)) });
  };
}
