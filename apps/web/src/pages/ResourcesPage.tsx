import { useEffect, useState, type ReactNode } from "react";
import {
  loadPluginsViaServer,
  loadSkillsViaServer,
  loadWorkflowTemplatesViaServer,
  type PluginSummary,
  type SkillSummary,
} from "../runWorkflowClient";
import type { WorkflowTemplate } from "../state/sampleWorkflows";

export const ResourcesPage = () => {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);

  useEffect(() => {
    const load = async () => {
      const [loadedPlugins, loadedSkills, loadedTemplates] = await Promise.all([
        loadPluginsViaServer(),
        loadSkillsViaServer(),
        loadWorkflowTemplatesViaServer(),
      ]);
      setPlugins(loadedPlugins ?? []);
      setSkills(loadedSkills ?? []);
      setTemplates(loadedTemplates ?? []);
    };
    void load();
  }, []);

  return (
    <main className="resources-page">
      <div className="page-title-row">
        <div>
          <h1>Resources</h1>
          <p>Existing runtime resources only. No fake resource system is created here.</p>
        </div>
      </div>
      <section className="resource-grid">
        <ResourceColumn title="Workflow Templates" empty="No templates returned by /api/templates.">
          {templates.map((template) => (
            <article key={template.id} className="resource-row">
              <strong>{template.label.en}</strong>
              <span>{template.description.en}</span>
            </article>
          ))}
        </ResourceColumn>
        <ResourceColumn title="Plugins" empty="No plugins returned by /api/plugins.">
          {plugins.map((plugin) => (
            <article key={plugin.id} className="resource-row">
              <strong>{plugin.label}</strong>
              <span>{plugin.description}</span>
            </article>
          ))}
        </ResourceColumn>
        <ResourceColumn title="Skills" empty="No skills returned by /api/skills.">
          {skills.map((skill) => (
            <article key={skill.id} className="resource-row">
              <strong>{skill.label.en}</strong>
              <span>{skill.content.en}</span>
            </article>
          ))}
        </ResourceColumn>
      </section>
    </main>
  );
};

const ResourceColumn = ({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) => {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="resource-column">
      <h2>{title}</h2>
      {hasChildren ? children : <p className="muted">{empty}</p>}
    </section>
  );
};
