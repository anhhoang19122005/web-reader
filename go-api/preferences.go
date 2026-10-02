package readerapi

import (
	"encoding/json"
	"math"
	"net/http"
	"slices"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type preferencesDocument struct {
	Preferences map[string]any `bson:"preferences" json:"preferences"`
	UpdatedAt   *time.Time     `bson:"updatedAt" json:"updatedAt"`
}

func validatePreferences(values map[string]json.RawMessage) (bson.M, bool) {
	if len(values) == 0 {
		return nil, false
	}
	set := bson.M{}
	for key, raw := range values {
		var value any
		if json.Unmarshal(raw, &value) != nil {
			return nil, false
		}
		valid := false
		switch key {
		case "theme":
			s, ok := value.(string)
			valid = ok && slices.Contains([]string{"light", "sepia", "dark", "forest", "ocean", "sakura", "sunset"}, s)
		case "font":
			s, ok := value.(string)
			valid = ok && (s == "sans" || s == "serif")
		case "sound":
			s, ok := value.(string)
			valid = ok && (s == "brown" || s == "rain")
		case "leaves":
			_, valid = value.(bool)
		case "fontSize", "lineHeight", "columnWidth", "ambientVolume":
			n, ok := value.(float64)
			if ok {
				switch key {
				case "fontSize":
					valid = n >= 16 && n <= 28 && n == math.Trunc(n)
				case "lineHeight":
					valid = n >= 1.5 && n <= 2.2 && math.Abs(n*10-math.Round(n*10)) < 1e-8
				case "columnWidth":
					valid = n == 60 || n == 68 || n == 75
				case "ambientVolume":
					valid = n >= 0 && n <= 0.3
				}
			}
		}
		if !valid {
			return nil, false
		}
		set["preferences."+key] = value
	}
	return set, true
}

func (a *App) preferencesRoute(w http.ResponseWriter, r *http.Request) *apiError {
	collection := a.collection("reading_preferences")
	if r.Method == http.MethodPatch {
		var values map[string]json.RawMessage
		if err := decodeJSON(r, &values); err != nil {
			return newAPIError(400, "VALIDATION_ERROR", "Tùy chỉnh không hợp lệ.")
		}
		set, valid := validatePreferences(values)
		if !valid {
			return newAPIError(400, "VALIDATION_ERROR", "Trường hoặc giá trị tùy chỉnh không hợp lệ.")
		}
		set["updatedAt"] = time.Now().UTC()
		_, err := collection.UpdateOne(r.Context(), bson.M{"_id": singleUserID}, bson.M{"$set": set}, options.UpdateOne().SetUpsert(true))
		if err != nil {
			return databaseError(err)
		}
	}
	var document preferencesDocument
	err := collection.FindOne(r.Context(), bson.M{"_id": singleUserID}).Decode(&document)
	if err != nil && !errorsIsNoRows(err) {
		return databaseError(err)
	}
	writeJSON(w, 200, document)
	return nil
}
