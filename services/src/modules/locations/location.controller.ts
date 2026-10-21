import { type RequestHandler } from 'express';
import { ForbiddenError } from '../../common/errors/app-error.js';
import { idParamsSchema } from '../../common/validation.js';
import { CrudController } from '../../http/crud.js';
import { getRequestId } from '../../middleware/request-id.js';
import { getStaffContext } from '../../middleware/staff-auth.js';
import {
  bedFilterSchema,
  buildingFilterSchema,
  bulkBedsSchema,
  createBedSchema,
  createBuildingSchema,
  createFloorSchema,
  createRoomSchema,
  createWardSchema,
  floorFilterSchema,
  roomFilterSchema,
  updateBedSchema,
  updateBuildingSchema,
  updateFloorSchema,
  updateRoomSchema,
  updateWardSchema,
  wardFilterSchema,
} from './location.schemas.js';
import { type LocationService } from './location.service.js';

// One standard controller per level of the hierarchy, each handing its parsed
// input straight to that level's service, plus bulk bed creation.
export class LocationController {
  public readonly buildings;
  public readonly floors;
  public readonly wards;
  public readonly rooms;
  public readonly beds;

  public constructor(private readonly locations: LocationService) {
    this.buildings = new CrudController(
      locations.buildings,
      { singular: 'building', plural: 'buildings' },
      { filter: buildingFilterSchema, create: createBuildingSchema, update: updateBuildingSchema },
    );
    this.floors = new CrudController(
      locations.floors,
      { singular: 'floor', plural: 'floors' },
      { filter: floorFilterSchema, create: createFloorSchema, update: updateFloorSchema },
    );
    this.wards = new CrudController(
      locations.wards,
      { singular: 'ward', plural: 'wards' },
      { filter: wardFilterSchema, create: createWardSchema, update: updateWardSchema },
    );
    this.rooms = new CrudController(
      locations.rooms,
      { singular: 'room', plural: 'rooms' },
      { filter: roomFilterSchema, create: createRoomSchema, update: updateRoomSchema },
    );
    this.beds = new CrudController(
      locations.beds,
      { singular: 'bed', plural: 'beds' },
      { filter: bedFilterSchema, create: createBedSchema, update: updateBedSchema },
    );
  }

  // Creating rooms as well as beds also needs the location permission.
  public readonly bulkBeds: RequestHandler = async (request, response) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = bulkBedsSchema.parse(request.body);
    const context = getStaffContext(request);
    if (input.mode === 'ROOMS' && !context.hospitalPermissions.has('location.manage')) {
      throw new ForbiddenError();
    }
    const created = await this.locations.beds.bulkCreate(
      context,
      id,
      input,
      getRequestId(response),
    );
    response.status(201).json(created);
  };
}
