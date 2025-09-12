import { secureStorage } from "./encryption";

export interface FavoriteQuery {
    id: string;
    connectionId: string;
    name: string;
    sql: string;
    description?: string;
    createdAt: string;
}

const FAVORITES_STORAGE_KEY = "favorite-queries";

export class FavoritesManager {
    static getFavorites(connectionId?: string): FavoriteQuery[] {
        try {
            const stored = secureStorage.get<FavoriteQuery[]>(FAVORITES_STORAGE_KEY);
            const favorites = stored || [];

            if (connectionId) {
                return favorites.filter(fav => fav.connectionId === connectionId);
            }

            return favorites;
        } catch (error) {
            console.error("Error loading favorites:", error);
            return [];
        }
    }

    static saveFavorite(favorite: Omit<FavoriteQuery, 'id' | 'createdAt'>): FavoriteQuery {
        try {
            const favorites = this.getFavorites();
            const newFavorite: FavoriteQuery = {
                ...favorite,
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                createdAt: new Date().toISOString()
            };

            favorites.push(newFavorite);
            secureStorage.set(FAVORITES_STORAGE_KEY, favorites);

            return newFavorite;
        } catch (error) {
            console.error("Error saving favorite:", error);
            throw error;
        }
    }

    static deleteFavorite(favoriteId: string): boolean {
        try {
            const favorites = this.getFavorites();
            const filteredFavorites = favorites.filter(fav => fav.id !== favoriteId);

            if (filteredFavorites.length === favorites.length) {
                return false; // Favorite not found
            }

            secureStorage.set(FAVORITES_STORAGE_KEY, filteredFavorites);
            return true;
        } catch (error) {
            console.error("Error deleting favorite:", error);
            return false;
        }
    }

    static updateFavorite(favoriteId: string, updates: Partial<Pick<FavoriteQuery, 'name' | 'sql' | 'description'>>): boolean {
        try {
            const favorites = this.getFavorites();
            const favoriteIndex = favorites.findIndex(fav => fav.id === favoriteId);

            if (favoriteIndex === -1) {
                return false; // Favorite not found
            }

            favorites[favoriteIndex] = { ...favorites[favoriteIndex], ...updates };
            secureStorage.set(FAVORITES_STORAGE_KEY, favorites);

            return true;
        } catch (error) {
            console.error("Error updating favorite:", error);
            return false;
        }
    }

    static exportFavorites(connectionId?: string): string {
        const favorites = this.getFavorites(connectionId);
        return JSON.stringify(favorites, null, 2);
    }

    static importFavorites(jsonData: string): number {
        try {
            const importedFavorites: FavoriteQuery[] = JSON.parse(jsonData);
            const existingFavorites = this.getFavorites();

            // Add imported favorites with new IDs to avoid conflicts
            const newFavorites = importedFavorites.map(fav => ({
                ...fav,
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                createdAt: new Date().toISOString()
            }));

            const allFavorites = [...existingFavorites, ...newFavorites];
            secureStorage.set(FAVORITES_STORAGE_KEY, allFavorites);

            return newFavorites.length;
        } catch (error) {
            console.error("Error importing favorites:", error);
            throw error;
        }
    }
}
