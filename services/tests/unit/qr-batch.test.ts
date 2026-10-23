import { describe, expect, it } from 'vitest';
import { bedLocationLabel, sortBedsForLabels } from '../../src/modules/qr/qr-batch.js';

function bed(code: string, floorLevel: number, buildingCode = 'MAIN') {
  return {
    code,
    room: { code: 'R1', name: 'Room 1' },
    ward: {
      code: 'GENERAL',
      name: 'General Ward',
      floor: {
        code: `F${floorLevel}`,
        name: `Floor ${floorLevel}`,
        level: floorLevel,
        building: { code: buildingCode, name: 'Main Building' },
      },
    },
  };
}

describe('QR batch label presentation', () => {
  it('sorts by location and uses natural bed-number ordering', () => {
    const beds = [bed('Bed 10', 1), bed('Bed 2', 1), bed('Bed 1', 2)];

    expect(sortBedsForLabels(beds).map((item) => item.code)).toEqual(['Bed 2', 'Bed 10', 'Bed 1']);
    expect(beds.map((item) => item.code)).toEqual(['Bed 10', 'Bed 2', 'Bed 1']);
  });

  it('builds the printed location label in one place', () => {
    expect(bedLocationLabel(bed('Bed 2', 1))).toBe(
      'Main Building · Floor 1 · General Ward · Room 1',
    );
  });
});
