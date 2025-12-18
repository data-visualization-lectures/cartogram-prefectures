var CloudApi = (function () {

    var APP_NAME = 'cartogram-prefectures'; // Sibling uses 'cartogram-japan'
    var BUCKET_NAME = 'user_projects';

    // Auth Key from _temp/dataviz-auth-client.js
    var SUPABASE_URL = "https://vebhoeiltxspsurqoxvl.supabase.co";
    var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlYmhvZWlsdHhzcHN1cnFveHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzAyMjI2MTIsImV4cCI6MjA0NTc5ODYxMn0.sV-Xf6wP_m46D_q-XN0oZfK9NogDqD9xV5sS-n6J8c4";

    async function getSupabaseConfig() {
        var globalAuthClient = window.supabase;
        if (!globalAuthClient || !globalAuthClient.auth) {
            throw new Error("認証クライアントが読み込まれていません。ページをリロードしてください。");
        }

        var sessionResponse = await globalAuthClient.auth.getSession();
        var session = sessionResponse.data.session;
        var sessionError = sessionResponse.error;

        if (sessionError || !session || !session.user) {
            console.warn("Session check failed:", sessionError);
            throw new Error("ログインしてください。");
        }

        return {
            supabaseUrl: SUPABASE_URL,
            supabaseKey: SUPABASE_ANON_KEY,
            accessToken: session.access_token,
            user: session.user
        };
    }

    async function getProjects() {
        console.log("Fetching projects...");
        try {
            var config = await getSupabaseConfig();
            // Only select current app's projects
            var endpoint = config.supabaseUrl + "/rest/v1/projects?select=id,name,created_at,updated_at,thumbnail_path&app_name=eq." + APP_NAME + "&order=updated_at.desc&apikey=" + config.supabaseKey;

            var response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + config.accessToken,
                    'Content-Type': 'application/json',
                    'Prefer': 'count=exact'
                }
            });

            if (!response.ok) {
                throw new Error("Projects fetch failed: " + response.status);
            }

            var data = await response.json();
            return data;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    function generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    async function saveProject(projectData, projectName, thumbnailBlob) {
        console.log("Saving project...");
        try {
            var config = await getSupabaseConfig();
            var id = projectData.id || generateUUID();
            var now = new Date().toISOString();

            // Path pattern: user_id/project_id.json
            var jsonFilePath = config.user.id + "/" + id + ".json";
            var thumbFilePath = config.user.id + "/" + id + ".png";

            // 1. Upload JSON to Storage
            var jsonEndpoint = config.supabaseUrl + "/storage/v1/object/" + BUCKET_NAME + "/" + jsonFilePath + "?apikey=" + config.supabaseKey;

            var jsonResponse = await fetch(jsonEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + config.accessToken,
                    'Content-Type': 'application/json',
                    'x-upsert': 'true'
                },
                body: JSON.stringify(projectData)
            });

            if (!jsonResponse.ok) {
                throw new Error("Storage upload failed: " + jsonResponse.status);
            }

            // 2. Upload Thumbnail (Optional)
            if (thumbnailBlob) {
                var thumbEndpoint = config.supabaseUrl + "/storage/v1/object/" + BUCKET_NAME + "/" + thumbFilePath + "?apikey=" + config.supabaseKey;
                await fetch(thumbEndpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + config.accessToken,
                        'Content-Type': 'image/png',
                        'x-upsert': 'true'
                    },
                    body: thumbnailBlob
                });
            }

            // 3. Save Metadata to DB
            var payload = {
                id: id,
                user_id: config.user.id,
                name: projectName || 'Untitled Project',
                storage_path: jsonFilePath,
                thumbnail_path: thumbnailBlob ? thumbFilePath : null,
                app_name: APP_NAME,
                created_at: projectData.created_at || now,
                updated_at: now
            };

            var dbEndpoint = config.supabaseUrl + "/rest/v1/projects?apikey=" + config.supabaseKey;
            var dbResponse = await fetch(dbEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + config.accessToken,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates,return=representation'
                },
                body: JSON.stringify(payload)
            });

            if (!dbResponse.ok) {
                throw new Error("DB save failed: " + dbResponse.status);
            }

            var result = await dbResponse.json();
            return result && result.length > 0 ? result[0] : null;

        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    async function loadProject(projectId) {
        console.log("Loading project: " + projectId);
        try {
            var config = await getSupabaseConfig();

            // 1. Get storage path from DB (Optional, but good for validation)
            // Actually, we can assume the path is user_id/project_id.json if we follow convention, 
            // but let's just fetch the file directly if we have projectId? 
            // Wait, we need the user_id of the owner. 
            // If we are loading our OWN project, we know our user_id. 
            // If we are loading shared, we might need to look up.
            // Assuming user only loads their own projects for now.

            var jsonFilePath = config.user.id + "/" + projectId + ".json";
            var endpoint = config.supabaseUrl + "/storage/v1/object/" + BUCKET_NAME + "/" + jsonFilePath + "?apikey=" + config.supabaseKey;

            var response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + config.accessToken
                }
            });

            if (!response.ok) {
                throw new Error("Project file not found or access denied.");
            }

            var projectData = await response.json();
            return projectData;

        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    return {
        getProjects: getProjects,
        saveProject: saveProject,
        loadProject: loadProject
    };

})();
