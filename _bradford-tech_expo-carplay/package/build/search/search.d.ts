import type { EventSubscription } from 'expo-modules-core';
import type { SearchResultItem, SearchResultSelectedEvent, SearchTextUpdatedEvent } from './search.types';
export declare function createSearchTemplate(): Promise<string>;
export declare function updateSearchResults(requestId: string, results: SearchResultItem[]): Promise<void>;
export declare function addSearchTextListener(listener: (event: SearchTextUpdatedEvent) => void): EventSubscription;
export declare function addSearchResultSelectedListener(listener: (event: SearchResultSelectedEvent) => void): EventSubscription;
export declare function addSearchButtonPressedListener(listener: () => void): EventSubscription;
//# sourceMappingURL=search.d.ts.map