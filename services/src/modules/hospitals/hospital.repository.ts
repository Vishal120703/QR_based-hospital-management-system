import { type Prisma } from '@prisma/client';
import { type Db } from '../../database/client.js';

// Hospitals, their clients (customers), and their logos.
export class HospitalRepository {
  public findProfile(db: Db, hospitalId: string) {
    return db.hospital.findFirst({
      where: { id: hospitalId },
      select: {
        id: true,
        name: true,
        code: true,
        timezone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        logo: { select: { publicId: true, byteSize: true, updatedAt: true } },
      },
    });
  }

  public findActive(db: Db, hospitalId: string) {
    return db.hospital.findFirst({ where: { id: hospitalId, status: 'ACTIVE' } });
  }

  public findByCode(db: Db, code: string) {
    return db.hospital.findUnique({ where: { code } });
  }

  public create(db: Db, data: { name: string; code: string; timezone: string; clientId: string }) {
    return db.hospital.create({ data });
  }

  public updateProfile(db: Db, hospitalId: string, data: { name?: string; timezone?: string }) {
    return db.hospital.update({ where: { id: hospitalId }, data });
  }

  public findClient(db: Db, id: string) {
    return db.client.findUnique({ where: { id } });
  }

  public findClientByCode(db: Db, code: string) {
    return db.client.findUnique({ where: { code } });
  }

  public createClient(
    db: Db,
    data: {
      name: string;
      code: string;
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
    },
  ) {
    return db.client.create({ data });
  }

  public upsertLogo(
    db: Db,
    hospitalId: string,
    values: Omit<Prisma.HospitalLogoUncheckedCreateInput, 'hospitalId'>,
  ) {
    return db.hospitalLogo.upsert({
      where: { hospitalId },
      create: { hospitalId, ...values },
      update: values,
    });
  }

  public async deleteLogo(db: Db, hospitalId: string): Promise<number> {
    return (await db.hospitalLogo.deleteMany({ where: { hospitalId } })).count;
  }

  public findLogo(db: Db, publicId: string) {
    return db.hospitalLogo.findUnique({
      where: { publicId },
      select: { contentType: true, data: true },
    });
  }
}
