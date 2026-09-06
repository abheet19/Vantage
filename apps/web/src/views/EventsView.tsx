/**
 * EventsView.tsx — the event catalog explorer (03-UI S5, adapted).
 *
 * Why it exists: it renders `GET /v1/events/catalog` — every event name with its count and first/last
 * seen, and, on click, that event's property keys with their JSON types and a sampled distinct-value
 * count. Event names and property keys are data, rendered as text (design §4.2 L0). The prototype's "raw
 * last 50 events" panel is dropped on purpose: the catalog contract carries no property values or rows
 * (that is the injection vector LLD §9 closes), so there is no honest source for raw events here.
 */
import { useMemo, useState, type JSX } from 'react';
import type { EventCatalog, ProjectRow } from '@vantage/contracts';
import { Chip } from '../components/Chip.js';
import { Icon } from '../components/Icons.js';
import { Skeleton, StateCard } from '../components/StateCard.js';
import { WithProject } from '../components/WithProject.js';
import { formatCount, formatDateTime } from '../lib/format.js';
import { useCatalog } from '../lib/hooks.js';

function Explorer({ project, catalog }: { project: ProjectRow; catalog: EventCatalog }): JSX.Element {
  const [selected, setSelected] = useState<string>(() => catalog.events[0]?.event ?? '');
  const totalEvents = useMemo(() => catalog.events.reduce((n, e) => n + e.count, 0), [catalog]);
  const current = catalog.events.find((e) => e.event === selected) ?? catalog.events[0] ?? null;

  return (
    <>
      <div className="cols" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="panel">
          <div className="panel-h">
            <h2>Event names</h2>
            <Chip tone="faint">
              {formatCount(totalEvents)} events · {catalog.events.length} names
            </Chip>
            <span className="grow" />
            <span className="small faint">click a row for its properties</span>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Event</th>
                <th className="r">Events</th>
                <th className="r">First seen</th>
                <th className="r">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {catalog.events.map((e) => (
                <tr key={e.event} className={`clickable${e.event === selected ? ' sel' : ''}`} onClick={() => setSelected(e.event)}>
                  <td>
                    <code>{e.event}</code>
                  </td>
                  <td className="r">{formatCount(e.count)}</td>
                  <td className="r">{formatDateTime(e.first_seen, catalog.timezone)}</td>
                  <td className="r">{formatDateTime(e.last_seen, catalog.timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>
              Properties · <code>{current?.event ?? '—'}</code>
            </h2>
            <Chip tone="faint">from the catalog sample</Chip>
          </div>
          {current && current.properties.length > 0 ? (
            <table className="data">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Types</th>
                  <th className="r">Distinct (sampled)</th>
                </tr>
              </thead>
              <tbody>
                {current.properties.map((p) => (
                  <tr key={p.key}>
                    <td>
                      <code>{p.key}</code>
                    </td>
                    <td>
                      {p.types.map((t) => (
                        <span key={t} className="typ">
                          {t}
                        </span>
                      ))}
                    </td>
                    <td className="r">{formatCount(p.cardinality_sample)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="ran-nothing">
              <Icon name="i-info" />
              This event has no property keys in the catalog sample.
            </div>
          )}
        </div>
      </div>
      <p className="small faint" style={{ marginTop: 12 }}>
        Project {project.name} · {catalog.timezone}. The catalog holds names, types and counts only — never a property value.
      </p>
    </>
  );
}

function EventsScreen({ project }: { project: ProjectRow }): JSX.Element {
  const { data, loading, error, reload } = useCatalog(project.project_id);
  if (loading) {
    return (
      <div className="panel">
        <Skeleton />
      </div>
    );
  }
  if (error) {
    return (
      <StateCard variant="error" icon="i-db" title="Could not load events" raw={{ heading: 'Error', text: error.message }} actions={<button type="button" className="btn primary" onClick={reload}><Icon name="i-rotate" />Retry</button>}>
        The event catalog could not be read.
      </StateCard>
    );
  }
  if (!data || data.events.length === 0) {
    return (
      <StateCard variant="empty" title="No events yet">
        This project has an API key and a timezone but has received no events. Send one batch from Projects &amp; ingest and this list fills in.
      </StateCard>
    );
  }
  return <Explorer project={project} catalog={data} />;
}

export function EventsView(): JSX.Element {
  return (
    <section className="screen" aria-labelledby="h-events">
      <div className="screen-head">
        <div>
          <h1 id="h-events">Events</h1>
          <p>Every event name this project has received, with counts and first/last seen. Event names are data: rendered as text, never interpreted.</p>
        </div>
      </div>
      <WithProject>{(project) => <EventsScreen project={project} />}</WithProject>
    </section>
  );
}
