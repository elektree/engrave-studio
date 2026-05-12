import { Project } from '../state/project';

export async function exportLaserSvg(project: Project, options: { strokeOnly: boolean; textToPath: boolean }): Promise<string> {
  // Filled in by Task 13. For now, throw to make the missing wiring obvious.
  void project; void options;
  throw new Error('exportLaserSvg not implemented yet');
}
