import { type PrismaClient } from '@prisma/client';
import { BedService } from './bed.service.js';
import { BuildingService } from './building.service.js';
import { FloorService } from './floor.service.js';
import { LocationRepository } from './location.repository.js';
import { RoomService } from './room.service.js';
import { WardService } from './ward.service.js';

// The Building → Floor → Ward → Room → Bed hierarchy, one service per level.
// Each offers list, get, create, update, and remove; the shared rules (active
// parents, area filters, serializable writes) live in location-rules.ts and
// location-access.ts.
export class LocationService {
  public readonly buildings: BuildingService;
  public readonly floors: FloorService;
  public readonly wards: WardService;
  public readonly rooms: RoomService;
  public readonly beds: BedService;

  public constructor(database: PrismaClient, locations = new LocationRepository()) {
    this.buildings = new BuildingService(database, locations);
    this.floors = new FloorService(database, locations);
    this.wards = new WardService(database, locations);
    this.rooms = new RoomService(database, locations);
    this.beds = new BedService(database, locations);
  }
}
