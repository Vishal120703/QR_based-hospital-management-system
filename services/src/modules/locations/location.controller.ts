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

// One standard controller per level of the hierarchy, plus bulk bed creation.
export class LocationController {
  public readonly buildings;
  public readonly floors;
  public readonly wards;
  public readonly rooms;
  public readonly beds;

  public constructor(private readonly locations: LocationService) {
    this.buildings = new CrudController(
      {
        list: (context, filter) => locations.listBuildings(context, filter),
        get: (context, id) => locations.getBuilding(context, id),
        create: (context, input, requestId) => locations.createBuilding(context, input, requestId),
        update: (context, id, input, requestId) =>
          locations.updateBuilding(context, id, input, requestId),
        remove: (context, id, requestId) => locations.deleteBuilding(context, id, requestId),
      },
      { singular: 'building', plural: 'buildings' },
      { filter: buildingFilterSchema, create: createBuildingSchema, update: updateBuildingSchema },
    );
    this.floors = new CrudController(
      {
        list: (context, filter) => locations.listFloors(context, filter),
        get: (context, id) => locations.getFloor(context, id),
        create: (context, input, requestId) => locations.createFloor(context, input, requestId),
        update: (context, id, input, requestId) =>
          locations.updateFloor(context, id, input, requestId),
        remove: (context, id, requestId) => locations.deleteFloor(context, id, requestId),
      },
      { singular: 'floor', plural: 'floors' },
      { filter: floorFilterSchema, create: createFloorSchema, update: updateFloorSchema },
    );
    this.wards = new CrudController(
      {
        list: (context, filter) => locations.listWards(context, filter),
        get: (context, id) => locations.getWard(context, id),
        create: (context, input, requestId) => locations.createWard(context, input, requestId),
        update: (context, id, input, requestId) =>
          locations.updateWard(context, id, input, requestId),
        remove: (context, id, requestId) => locations.deleteWard(context, id, requestId),
      },
      { singular: 'ward', plural: 'wards' },
      { filter: wardFilterSchema, create: createWardSchema, update: updateWardSchema },
    );
    this.rooms = new CrudController(
      {
        list: (context, filter) => locations.listRooms(context, filter),
        get: (context, id) => locations.getRoom(context, id),
        create: (context, input, requestId) => locations.createRoom(context, input, requestId),
        update: (context, id, input, requestId) =>
          locations.updateRoom(context, id, input, requestId),
        remove: (context, id, requestId) => locations.deleteRoom(context, id, requestId),
      },
      { singular: 'room', plural: 'rooms' },
      { filter: roomFilterSchema, create: createRoomSchema, update: updateRoomSchema },
    );
    this.beds = new CrudController(
      {
        list: (context, filter) => locations.listBeds(context, filter),
        get: (context, id) => locations.getBed(context, id),
        create: (context, input, requestId) => locations.createBed(context, input, requestId),
        update: (context, id, input, requestId) =>
          locations.updateBed(context, id, input, requestId),
        remove: (context, id, requestId) => locations.deleteBed(context, id, requestId),
      },
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
    const created = await this.locations.bulkCreateBeds(context, id, input, getRequestId(response));
    response.status(201).json(created);
  };
}
