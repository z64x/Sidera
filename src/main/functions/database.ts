import { queryDatabase, addToDatabase, deleteFromDatabase } from '../lancedb/client';
import { getActiveProfile } from '../config/profiles';

export interface DatabaseOperationResult {
  success: boolean;
  message: string;
  data?: any;
}

export async function checkDatabase(query: string, profileId?: string): Promise<DatabaseOperationResult> {
  try {
    // Use provided profileId or get active profile
    const activeProfile = profileId ? null : getActiveProfile();
    const effectiveProfileId = profileId || activeProfile?.id;

    const results = await queryDatabase(query, {
      profileId: effectiveProfileId,
      includeKnowledge: true,
    });

    // Separate memory and knowledge results
    const memoryResults = results.filter(r => r.source === 'memory');
    const knowledgeResults = results.filter(r => r.source === 'knowledge');

    return {
      success: true,
      message: `Found ${results.length} relevant results (${memoryResults.length} from memory, ${knowledgeResults.length} from knowledge files)`,
      data: {
        all: results,
        memory: memoryResults,
        knowledge: knowledgeResults,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Database query failed: ${error.message}`,
    };
  }
}

export async function addToDatabaseFunction(
  content: string,
  metadata?: Record<string, any>,
  profileId?: string
): Promise<DatabaseOperationResult> {
  try {
    // Use provided profileId or get active profile
    const activeProfile = profileId ? null : getActiveProfile();
    const effectiveProfileId = profileId || activeProfile?.id;

    // Add profileId to metadata if we have one
    const enrichedMetadata = effectiveProfileId
      ? { ...metadata, profileId: effectiveProfileId }
      : metadata;

    await addToDatabase(content, enrichedMetadata);
    return {
      success: true,
      message: 'Content added to database successfully',
    };
  } catch (error: any) {
    const rawMessage = String(error?.message || error || 'Unknown error');
    const message = rawMessage.includes('embedding')
      ? rawMessage
      : `Failed to add to database: ${rawMessage}`;
    return {
      success: false,
      message,
    };
  }
}

export async function deleteFromDatabaseFunction(id: string, profileId?: string): Promise<DatabaseOperationResult> {
  try {
    const activeProfile = profileId ? null : getActiveProfile();
    const effectiveProfileId = profileId || activeProfile?.id;
    const deletedCount = await deleteFromDatabase(id, { profileId: effectiveProfileId });

    if (deletedCount === 0) {
      return {
        success: false,
        message: 'No matching memory entry was found for that id',
      };
    }

    return {
      success: true,
      message: `Deleted ${deletedCount} memory entry from database`,
      data: { deletedCount },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Failed to delete from database: ${error.message}`,
    };
  }
}
