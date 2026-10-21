import { ChevronRight, Plus, TriangleAlert } from 'lucide-react';
import { type PublicCategory, type PublicRequest, type PublicRequestStatus } from '../../api';
import { type PatientText } from './patient-copy';
import { categoryLook, serviceIcon } from './patient-looks';

const activeStatuses: PublicRequestStatus[] = ['SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS'];

// One category of services the patient can ask for. A service already
// requested and still open links to that request instead.
export function ServiceCategory({
  category,
  index,
  t,
  requests,
  isOpen,
  busyServiceId,
  busy,
  onToggle,
  onRequest,
  onViewRequest,
}: {
  category: PublicCategory;
  // Its position, which picks a colour when the name suggests none.
  index: number;
  t: PatientText;
  requests: PublicRequest[];
  isOpen: boolean;
  // The service being requested right now, if any.
  busyServiceId: string | null;
  // A request or cancellation is in progress.
  busy: boolean;
  onToggle: () => void;
  onRequest: (serviceId: string) => void;
  onViewRequest: (publicId: string) => void;
}) {
  const look = categoryLook(category, index);
  const CategoryIcon = look.icon;
  return (
    <section
      className={`pp-category pp-tone-${look.tone}`}
      aria-labelledby={`category-${category.id}`}
    >
      <button
        type="button"
        className="pp-category-head"
        aria-expanded={isOpen}
        aria-controls={`services-${category.id}`}
        aria-label={isOpen ? t.hideServices(category.name) : t.showServices(category.name)}
        onClick={onToggle}
      >
        <span className="pp-icon pp-icon-large" aria-hidden="true">
          <CategoryIcon size={30} />
        </span>
        <span className="pp-category-text">
          <strong id={`category-${category.id}`}>{category.name}</strong>
          <span>{category.description ?? t.serviceCount(category.services.length)}</span>
        </span>
        <ChevronRight className="pp-chevron" size={22} aria-hidden="true" />
      </button>
      {isOpen && (
        <div className="pp-services" id={`services-${category.id}`}>
          {category.emergencyNotice && (
            <p className="pp-urgent">
              <TriangleAlert size={16} aria-hidden="true" />
              {t.urgentHint}
            </p>
          )}
          {category.services.map((service) => {
            const Icon = serviceIcon(service.name, CategoryIcon);
            const existing = requests.find(
              (request) =>
                request.serviceId === service.id && activeStatuses.includes(request.status),
            );
            const body = (
              <>
                <span className="pp-icon" aria-hidden="true">
                  <Icon size={22} />
                </span>
                <span className="pp-service-text">
                  <strong>{service.name}</strong>
                  {busyServiceId === service.id ? (
                    <small>{t.requesting}</small>
                  ) : (
                    service.description && <small>{service.description}</small>
                  )}
                </span>
              </>
            );
            return existing ? (
              <a
                key={service.id}
                className="pp-service pp-service-active"
                href={`#request-${existing.publicId}`}
                aria-label={t.viewRequestFor(service.name)}
                onClick={() => onViewRequest(existing.publicId)}
              >
                {body}
                <span className={`pp-status pp-status-${existing.status.toLowerCase()}`}>
                  {t.requestStatus[existing.status]}
                </span>
              </a>
            ) : (
              <button
                key={service.id}
                type="button"
                className="pp-service"
                aria-label={t.requestFor(service.name)}
                disabled={busy}
                onClick={() => onRequest(service.id)}
              >
                {body}
                <span className="pp-add" aria-hidden="true">
                  <Plus size={18} strokeWidth={2.5} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
