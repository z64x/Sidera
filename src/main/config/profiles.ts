import Store from 'electron-store';
import { KnowledgeFile, Profile } from '../../shared/types';
import { SIDERA_AGENT_ID, SIDERA_AGENT_NAME } from '../../shared/sidera';
import * as path from 'path';
import * as fs from 'fs/promises';
import { app } from 'electron';

const profileStore = new Store<{ profiles: Profile[]; activeProfileId: string | null; whatsappDefaultProfileId: string | null }>({
  name: 'profiles',
  defaults: {
    profiles: [],
    activeProfileId: null,
    whatsappDefaultProfileId: null,
  },
});

export function getAllProfiles(): Profile[] {
  return profileStore.get('profiles', []);
}

export function getProfile(id: string): Profile | null {
  const profiles = getAllProfiles();
  return profiles.find(p => p.id === id) || null;
}

export function getActiveProfile(): Profile | null {
  const activeId = profileStore.get('activeProfileId', null);
  if (!activeId) return null;
  return getProfile(activeId);
}

export function normalizeKnowledgeFile(file: KnowledgeFile): KnowledgeFile {
  return {
    ...file,
    status: file.status || 'indexed',
  };
}

export function normalizeProfile(profile: Profile): Profile {
  return {
    ...profile,
    knowledgeFiles: (profile.knowledgeFiles || []).map(normalizeKnowledgeFile),
  };
}

export function setActiveProfile(id: string | null): void {
  profileStore.set('activeProfileId', id);
}

export function createProfile(profile: Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>): Profile {
  const newProfile: Profile = {
    ...profile,
    id: Date.now().toString(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  const profiles = getAllProfiles();
  profiles.push(newProfile);
  profileStore.set('profiles', profiles);
  
  return newProfile;
}

export function updateProfile(id: string, updates: Partial<Omit<Profile, 'id' | 'createdAt'>>): Profile | null {
  const profiles = getAllProfiles();
  const index = profiles.findIndex(p => p.id === id);
  
  if (index === -1) return null;
  
  profiles[index] = {
    ...profiles[index],
    ...updates,
    updatedAt: Date.now(),
  };
  
  profileStore.set('profiles', profiles);
  return profiles[index];
}

export function deleteProfile(id: string): boolean {
  const profiles = getAllProfiles();
  const filtered = profiles.filter(p => p.id !== id);
  
  if (filtered.length === profiles.length) return false;
  
  profileStore.set('profiles', filtered);
  
  // Clear active profile if it was deleted
  const activeId = profileStore.get('activeProfileId', null);
  if (activeId === id) {
    profileStore.set('activeProfileId', null);
  }
  
  return true;
}

// Knowledge file storage helpers
export async function getKnowledgeFilesDir(profileId: string): Promise<string> {
  const config = await import('./storage').then(m => m.getConfig());
  const profilesDir = path.join(config.databasePath, 'profiles', profileId, 'knowledge');
  await fs.mkdir(profilesDir, { recursive: true });
  return profilesDir;
}

// Avatar storage helpers
export async function getProfileAvatarDir(profileId: string): Promise<string> {
  // Store avatar assets in the app's storage (userData) so they persist reliably
  // and don't depend on the configurable databasePath.
  const avatarDir = path.join(app.getPath('userData'), 'profiles', profileId, 'avatar');
  await fs.mkdir(avatarDir, { recursive: true });
  return avatarDir;
}

export async function copyProfileAvatarImage(profileId: string, sourcePath: string): Promise<string> {
  const avatarDir = await getProfileAvatarDir(profileId);
  const ext = path.extname(sourcePath) || '.png';
  const destPath = path.join(avatarDir, `avatar${ext.toLowerCase()}`);
  await fs.copyFile(sourcePath, destPath);
  return destPath;
}

export async function copyKnowledgeFile(profileId: string, sourcePath: string, fileName: string): Promise<string> {
  const knowledgeDir = await getKnowledgeFilesDir(profileId);
  const destPath = path.join(knowledgeDir, fileName);
  await fs.copyFile(sourcePath, destPath);
  return destPath;
}

export async function deleteKnowledgeFile(profileId: string, fileId: string): Promise<boolean> {
  const profile = getProfile(profileId);
  if (!profile) return false;
  
  const file = profile.knowledgeFiles.find(f => f.id === fileId);
  if (!file) return false;
  
  try {
    await fs.unlink(file.path);
  } catch {
    // File might already be deleted, continue
  }
  
  const updatedFiles = profile.knowledgeFiles.filter(f => f.id !== fileId);
  updateProfile(profileId, { knowledgeFiles: updatedFiles });
  
  return true;
}

export function getWhatsAppDefaultProfile(): Profile | null {
  const whatsappProfileId = profileStore.get('whatsappDefaultProfileId', null);
  if (!whatsappProfileId) return null;
  if (whatsappProfileId === SIDERA_AGENT_ID) {
    return {
      id: SIDERA_AGENT_ID,
      name: SIDERA_AGENT_NAME,
      description: 'Super agent care orchestreaza subagenti ascunsi pentru taskuri complexe.',
      instructions: 'Coordoneaza Planner, Code Specialist si Reviewer pentru taskuri complexe.',
      defaultTool: [],
      avatarEmoji: String.fromCodePoint(0x2728),
      knowledgeFiles: [],
      createdAt: 0,
      updatedAt: 0,
    };
  }
  return getProfile(whatsappProfileId);
}

export function setWhatsAppDefaultProfile(id: string | null): void {
  profileStore.set('whatsappDefaultProfileId', id);
}

/**
 * Ensure a WhatsApp default profile exists, create one if it doesn't
 */
export function ensureWhatsAppDefaultProfile(): Profile {
  let profile = getWhatsAppDefaultProfile();
  
  if (!profile) {
    console.log('[WhatsApp Profile] No default profile found, creating one...');
    
    // Create a default WhatsApp profile
    profile = createProfile({
      name: 'WhatsApp Assistant',
      description: 'Asistent AI pentru mesaje WhatsApp',
      instructions: `Ești un asistent AI prietenos și util care răspunde la mesaje WhatsApp.

IMPORTANT: Răspunsurile tale TREBUIE să fie SCURTE - maxim 1000 de caractere! WhatsApp are limite stricte.

Caracteristici:
- Răspunzi în limba română (sau în limba în care ți se vorbește)
- Ești CONCIS și direct la subiect (maxim 1000 caractere!)
- Ești politicos și profesional
- Oferi răspunsuri clare dar SCURTE
- Pentru povești sau texte lungi, oferă doar un rezumat sau începutul
- Dacă nu știi ceva, recunoști sincer

Stil de comunicare:
- Folosește un ton prietenos și accesibil
- Evită răspunsuri prea tehnice
- Folosește emoji-uri când e potrivit 😊
- NICIODATĂ nu scrie mai mult de 1000 de caractere!

Exemple de răspunsuri bune:
- La "Hi, how are you?" → "Bună! Sunt grozav, mulțumesc! Cu ce te pot ajuta? 😊"
- La "Test" → "Salut! Testul a funcționat perfect! Sunt aici să te ajut. Ce ai nevoie?"
- La "Spune-mi o poveste" → "Odată ca niciodată... [poveste scurtă de 3-4 propoziții]. Vrei să continui povestea? 📖"

REGULA DE AUR: Dacă răspunsul tău depășește 1000 de caractere, OPREȘTE-TE și întreabă dacă utilizatorul vrea să continui!`,
      defaultTool: [],
      avatarEmoji: '💬',
      knowledgeFiles: []
    });
    
    // Set it as the default WhatsApp profile
    setWhatsAppDefaultProfile(profile.id);
    
    console.log('[WhatsApp Profile] Created default profile:', profile.name);
  }
  
  return profile;
}

