import { useState } from 'react';
import { staffApi, type Ward, type WardType } from '../../api';
import { floorSuggestion, unitPresets, wardTypes } from './location-types';
import { useAdmin } from '../workspace/AdminLayout';
import { type PanelTools } from './location-shared';
import { codeInput, nameMaxLength } from '../../lib/field-rules';

// Forms that add a building, a floor, or a unit (ward) to the layout.

export function AddBuildingForm({ tools }: { tools: PanelTools }) {
  const { token } = useAdmin();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  return (
    <form
      className="card create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void tools
          .run(() => staffApi.create(token, 'buildings', { code, name }), `${name} added.`)
          .then((saved) => {
            if (saved) {
              setCode('');
              setName('');
            }
          });
      }}
    >
      <h3>Add a building</h3>
      <p className="muted small">Optional. Use it for blocks, towers, or wings on a campus.</p>
      <label>
        Name
        <input
          value={name}
          required
          maxLength={120}
          placeholder="Main Block"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Code
        <input
          value={code}
          required
          {...codeInput}
          placeholder="MB"
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <button type="submit" disabled={tools.busy}>
        Add building
      </button>
    </form>
  );
}

export function AddFloorForm({ tools, buildingId }: { tools: PanelTools; buildingId?: string }) {
  const { token } = useAdmin();
  const [building, setBuilding] = useState(buildingId ?? '');
  const [level, setLevel] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  function changeLevel(value: string) {
    setLevel(value);
    if (!touched && value.trim() !== '' && Number.isInteger(Number(value))) {
      const suggestion = floorSuggestion(Number(value));
      setCode(suggestion.code);
      setName(suggestion.name);
    }
  }

  return (
    <form
      className="card create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void tools
          .run(
            () =>
              staffApi.create(token, 'floors', {
                code,
                name,
                ...(building ? { buildingId: building } : {}),
                ...(level.trim() !== '' ? { level: Number(level) } : {}),
              }),
            `${name} added.`,
          )
          .then((saved) => {
            if (saved) {
              setLevel('');
              setCode('');
              setName('');
              setTouched(false);
            }
          });
      }}
    >
      <h3>Add a floor</h3>
      {!buildingId && (
        <label>
          <span>
            Building <em>(optional)</em>
          </span>
          <select value={building} onChange={(event) => setBuilding(event.target.value)}>
            <option value="">Not in a building</option>
            {tools.layout.buildings
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        <span>
          Level <em>(recommended)</em>
        </span>
        <input
          type="number"
          min={-10}
          max={200}
          value={level}
          placeholder="0 = ground, -1 = basement"
          onChange={(event) => changeLevel(event.target.value)}
        />
      </label>
      <NameAndCode
        name={name}
        code={code}
        placeholders={['First Floor', 'F1']}
        onName={(value) => {
          setTouched(true);
          setName(value);
        }}
        onCode={(value) => {
          setTouched(true);
          setCode(value);
        }}
      />
      <button type="submit" disabled={tools.busy}>
        Add floor
      </button>
    </form>
  );
}

export function AddUnitForm({ tools, floorId }: { tools: PanelTools; floorId: string }) {
  const { token } = useAdmin();
  const [unitType, setUnitType] = useState<WardType>('GENERAL');
  const [name, setName] = useState(unitPresets.GENERAL.name);
  const [code, setCode] = useState(unitPresets.GENERAL.code);
  const [touched, setTouched] = useState(false);
  const preset = unitPresets[unitType];

  function changeType(next: WardType) {
    setUnitType(next);
    if (!touched) {
      setName(unitPresets[next].name);
      setCode(unitPresets[next].code);
    }
  }

  return (
    <form
      className="card create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void tools
          .run(async () => {
            const created = (await staffApi.create(token, 'wards', {
              floorId,
              unitType,
              code,
              name,
            })) as { ward?: Ward };
            // Open the new unit so beds can be added straight away.
            if (created.ward) tools.select({ kind: 'ward', id: created.ward.id });
          }, `${name} added. Now add its beds.`)
          .then((saved) => {
            if (saved) setTouched(false);
          });
      }}
    >
      <h3>Add a unit or ward</h3>
      <label>
        Type of unit
        <select value={unitType} onChange={(event) => changeType(event.target.value as WardType)}>
          {wardTypes.map((type) => (
            <option key={type} value={type}>
              {unitPresets[type].label}
            </option>
          ))}
        </select>
        <small className="muted">{preset.hint}</small>
      </label>
      <NameAndCode
        name={name}
        code={code}
        placeholders={['Male Medical Ward', 'MMW']}
        codeHint="Short and unique on this floor. Printed on QR labels."
        onName={(value) => {
          setTouched(true);
          setName(value);
        }}
        onCode={(value) => {
          setTouched(true);
          setCode(value);
        }}
      />
      <button type="submit" disabled={tools.busy}>
        Add unit
      </button>
    </form>
  );
}

// The name and code every new floor or unit needs.
function NameAndCode({
  name,
  code,
  placeholders,
  codeHint,
  onName,
  onCode,
}: {
  name: string;
  code: string;
  placeholders: [string, string];
  codeHint?: string;
  onName: (value: string) => void;
  onCode: (value: string) => void;
}) {
  return (
    <>
      <label>
        Name
        <input
          value={name}
          required
          maxLength={nameMaxLength}
          placeholder={placeholders[0]}
          onChange={(event) => onName(event.target.value)}
        />
      </label>
      <label>
        Code
        <input
          value={code}
          required
          {...codeInput}
          placeholder={placeholders[1]}
          onChange={(event) => onCode(event.target.value)}
        />
        {codeHint && <small className="muted">{codeHint}</small>}
      </label>
    </>
  );
}
