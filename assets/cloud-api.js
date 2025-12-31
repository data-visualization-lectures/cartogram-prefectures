var CloudApi = (function () {

    var APP_NAME = 'cartogram-prefectures'; // Sibling uses 'cartogram-japan'
    var BUCKET_NAME = 'user_projects';

    // Auth Key from _temp/dataviz-auth-client.js
    // Base URL for API requests (set by dataviz-auth-client.js)
    var API_URL = window.datavizApiUrl || "https://api.dataviz.jp";
    var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlYmhvZWlsdHhzcHN1cnFveHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNTY4MjMsImV4cCI6MjA4MDYzMjgyM30.5uf-D07Hb0JxL39X9yQ20P-5gFc1CRMdKWhDySrNZ0E";

    async function getSupabaseConfig() {
        var globalAuthClient = window.datavizSupabase;
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
            apiUrl: API_URL,
            supabaseKey: SUPABASE_ANON_KEY,
            accessToken: session.access_token,
            user: session.user
        };
    }

    async function getProjects() {
        console.log("Fetching projects...");
        try {
            var config = await getSupabaseConfig();
            // Use API endpoint as per specification
            var endpoint = config.apiUrl + "/api/projects?app=" + APP_NAME;

            var response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + config.accessToken,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error("Projects fetch failed: " + response.status);
            }

            var data = await response.json();
            // API returns { projects: [...] } format
            return data.projects || [];
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

    function blobToBase64DataURL(blob) {
        return new Promise(function (resolve, reject) {
            if (!blob) {
                resolve(null);
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                resolve(reader.result); // data:image/png;base64,...
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function saveProject(projectData, projectName, thumbnailBlob) {
        console.log("Saving project...");
        try {
            var config = await getSupabaseConfig();
            var id = projectData.id || generateUUID();
            var now = new Date().toISOString();

            // Convert thumbnail blob to Base64 Data URI if provided
            var thumbnailDataURL = null;
            if (thumbnailBlob) {
                thumbnailDataURL = await blobToBase64DataURL(thumbnailBlob);
            }

            // Prepare request body according to API specification
            var requestBody = {
                name: projectName || 'Untitled Project',
                app_name: APP_NAME,
                data: projectData
            };

            // Add thumbnail if available
            if (thumbnailDataURL) {
                requestBody.thumbnail = thumbnailDataURL;
            }

            // If projectData has an id, we should use PUT to update
            var isUpdate = projectData.id ? true : false;
            var endpoint = config.apiUrl + "/api/projects";
            var method = 'POST';

            if (isUpdate) {
                endpoint = config.apiUrl + "/api/projects/" + projectData.id;
                method = 'PUT';
                // For update, only send changed fields
                delete requestBody.app_name; // app_name doesn't change
            }

            var response = await fetch(endpoint, {
                method: method,
                headers: {
                    'Authorization': 'Bearer ' + config.accessToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                var errorText = await response.text();
                throw new Error("API save failed: " + response.status + " - " + errorText);
            }

            var result = await response.json();
            // API returns { project: {...} } format
            return result.project || null;

        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    async function loadProject(projectId) {
        console.log("Loading project: " + projectId);
        try {
            var config = await getSupabaseConfig();

            // Use API endpoint to get project data
            var endpoint = config.apiUrl + "/api/projects/" + projectId;

            var response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + config.accessToken,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error("Project file not found or access denied.");
            }

            // API returns the project data directly (not wrapped)
            var projectData = await response.json();
            return projectData;

        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    function getThumbnailUrl(projectId) {
        // Returns the URL for fetching thumbnail image
        // Note: This requires authentication, so it should be used with fetch + Authorization header
        return API_URL + "/api/projects/" + projectId + "/thumbnail";
    }

    return {
        getProjects: getProjects,
        saveProject: saveProject,
        loadProject: loadProject,
        getThumbnailUrl: getThumbnailUrl
    };

})();
