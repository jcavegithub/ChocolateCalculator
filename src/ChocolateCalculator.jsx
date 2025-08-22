import { db } from './lib/firebase';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import React from "react";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";

// Add styling helpers at the top of the component
const getInputStyle = (isDisabled) => {
  return isDisabled 
    ? "opacity-50 bg-gray-100" 
    : "border-2 border-blue-300 bg-blue-50 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200 focus:ring-opacity-50";
};

// Add a helper function for the auto-calc radio button styling
const getAutoCalcStyle = (isSelected) => {
  return isSelected
    ? "font-semibold text-blue-700 bg-blue-50 rounded-md py-1 px-2 border border-blue-300"
    : "";
};

// Add a new helper function to determine styling for percentage inputs
const getPercentageInputStyle = (isDisabled, percentageValue) => {
  const baseStyle = getInputStyle(isDisabled);
  const percentageNum = parseFloat(percentageValue);
  
  if (!isNaN(percentageNum) && percentageNum > 100) {
    return `${baseStyle} border-red-500 bg-red-50 text-red-700`;
  }
  
  return baseStyle;
};

// Add a constant to highlight the bar weight is a user-defined parameter
const BAR_WEIGHT_DESCRIPTION = "This is the fixed weight of one chocolate bar and serves as the foundation for all calculations";

// Update the component to emphasize bar weight as a user-defined parameter
export default function ChocolateCalculator() {
  // --- State Management ---
  const [numBars, setNumBars] = useState("");
  const [barWeight, setBarWeight] = useState(""); // User-defined parameter, never auto-calculated
  const [batchName, setBatchName] = useState("");
  const [totalBatchWeight, setTotalBatchWeight] = useState(0);
  const [ingredients, setIngredients] = useState(
    Array(5).fill().map(() => ({ 
      name: "", 
      weightPerBar: "", 
      percentage: "", 
      totalWeight: "", 
      staticField: "weightPerBar" 
    }))
  );
  const [savedBatches, setSavedBatches] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isNumBarsAuto, setIsNumBarsAuto] = useState(false);
  const [isNumBarsUserEntered, setIsNumBarsUserEntered] = useState(false);
  const [autoUpdateIndex, setAutoUpdateIndex] = useState(null);
  const [ingredientChangeTrigger, setIngredientChangeTrigger] = useState(false);
  const [activeEditField, setActiveEditField] = useState({ index: null, field: null });
  const [autoPercentageIndex, setAutoPercentageIndex] = useState(0); // Default to first ingredient
  const [weightUnit, setWeightUnit] = useState("g"); // "g" or "lbs"
  const [rawTotalWeightInputs, setRawTotalWeightInputs] = useState({});
  // Add a new state to track user-entered fields that shouldn't be auto-updated
  const [userEnteredFields, setUserEnteredFields] = useState({});
  const [isBarWeightUserSet, setIsBarWeightUserSet] = useState(false); // New state for bar weight user set
  // Add a new state to track the currently loaded batch
  const [currentBatchId, setCurrentBatchId] = useState(null); // Track the ID of currently loaded batch

  // --- Helper Functions ---
  // Update the formatValue function to always use 2 decimal places
  const formatValue = (value) => {
    // Always use 2 decimal places regardless of whether it's an integer
    return parseFloat(value).toFixed(2);
  };

  const areMandatoryFieldsFilled = () => {
    return (
      batchName.trim() !== "" &&
      (isNumBarsAuto || numBars > 0) &&
      barWeight > 0
    );
  };

  // The gramsToSelectedUnit function should be updated for consistency
  const gramsToSelectedUnit = (grams) => {
    if (!grams || isNaN(parseFloat(grams))) return "";
    const value = parseFloat(grams);
    // Use toFixed(2) for both lbs and g
    return weightUnit === "lbs" 
      ? (value / 453.59237).toFixed(2) 
      : parseFloat(value).toFixed(2);
  };

  const selectedUnitToGrams = (value) => {
    if (!value || isNaN(parseFloat(value))) return "";
    const numValue = parseFloat(value);
    // Store the full precision value when converting to grams
    return weightUnit === "lbs" ? (numValue * 453.59237).toString() : numValue.toString();
  };

  // --- Ingredient Management Functions ---
  const addIngredient = () => {
    setIngredients(prev => [
      ...prev,
      { 
        name: "", 
        weightPerBar: "", 
        percentage: "", 
        totalWeight: "", 
        staticField: "weightPerBar" 
      }
    ]);
  };

  const removeIngredient = (indexToRemove) => {
    if (ingredients.length <= 1) return; // Always keep at least one ingredient
    
    setIngredients(prev => prev.filter((_, index) => index !== indexToRemove));
    
    // Update autoPercentageIndex if needed
    if (autoPercentageIndex === indexToRemove) {
      // If removing the auto-percentage ingredient, set it to the first ingredient
      setAutoPercentageIndex(0);
    } else if (autoPercentageIndex > indexToRemove) {
      // If removing an ingredient before the auto-percentage one, adjust the index
      setAutoPercentageIndex(prev => prev - 1);
    }
    
    // Clean up user-entered fields tracking for removed ingredient
    setUserEnteredFields(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(key => {
        const [index] = key.split('-');
        if (parseInt(index) === indexToRemove) {
          delete updated[key];
        } else if (parseInt(index) > indexToRemove) {
          // Adjust indices for ingredients that moved up
          const [, field] = key.split('-');
          delete updated[key];
          updated[`${parseInt(index) - 1}-${field}`] = true;
        }
      });
      return updated;
    });
    
    // Clean up raw total weight inputs
    setRawTotalWeightInputs(prev => {
      const updated = { ...prev };
      delete updated[indexToRemove];
      // Shift indices for remaining ingredients
      Object.keys(updated).forEach(key => {
        const index = parseInt(key);
        if (index > indexToRemove) {
          updated[index - 1] = updated[key];
          delete updated[key];
        }
      });
      return updated;
    });
  };

  // Update the formatWeightWithUnit function to use 2 decimal places for grams too
  const formatWeightWithUnit = (grams) => {
    if (!grams || isNaN(parseFloat(grams))) return "N/A";
    const value = parseFloat(grams);
    if (weightUnit === "lbs") {
      return `${(value / 453.59237).toFixed(2)} lbs`;
    }
    // Changed from Math.round(value) to value.toFixed(2) for consistency
    return `${value.toFixed(2)} g`;
  };

  // --- Main Logic Functions ---
  // Update the updateIngredient function to properly recalculate in auto-bars mode
  const updateIngredient = (index, key, value) => {
    // Allow name updates even for auto-percentage ingredient
    // Otherwise block updates to auto-percentage ingredient in non-auto mode
    if (!isNumBarsAuto && index === autoPercentageIndex && key !== "name") {
      return;
    }

    const newIngredients = [...ingredients];
    
    // Handle empty values - now with cascading deletion of calculated values
    if (value === "") {
      // Set the current field to empty
      newIngredients[index][key] = value;
      
      // If this field is the "static field" (the one used for calculations),
      // we should also clear the other calculated fields
      if (key === newIngredients[index].staticField) {
        // Clear all calculated fields except the name
        if (key === "weightPerBar") {
          // If weightPerBar is cleared, also clear totalWeight and percentage
          newIngredients[index].totalWeight = "";
          newIngredients[index].percentage = "";
        } else if (key === "percentage") {
          // If percentage is cleared, also clear totalWeight and weightPerBar
          newIngredients[index].totalWeight = "";
          newIngredients[index].weightPerBar = "";
        } else if (key === "totalWeight") {
          // If totalWeight is cleared, also clear percentage and weightPerBar
          newIngredients[index].percentage = "";
          newIngredients[index].weightPerBar = "";
        }
        
        console.log(`Cleared calculated values for ingredient #${index + 1} after ${key} was deleted`);
      }
      
      // If in auto mode and the total weight is cleared, recalculate the batch total
      if (isNumBarsAuto && (key === "totalWeight" || newIngredients[index].totalWeight === "")) {
        // Trigger a recalculation of the total batch weight in the next cycle
        setTimeout(() => {
          setIngredientChangeTrigger(prev => !prev);
        }, 0);
      }
      
      setIngredients(newIngredients);
      return;
    }

    // Set active edit field to prevent circular updates
    setActiveEditField({ index, field: key });

    // Always store the value for the specified key
    newIngredients[index][key] = value;

    // Special handling for name field - just update the name and nothing else
    if (key === "name") {
      setIngredients(newIngredients);
      return; // Important: Return early to prevent further processing for name field
    }

    // Automatically set the staticField based on which field the user is editing
    if (key === "weightPerBar" && value !== "") {
      newIngredients[index].staticField = "weightPerBar";
    } else if (key === "percentage" && value !== "") {
      newIngredients[index].staticField = "percentage";
    } else if (key === "totalWeight" && value !== "") {
      newIngredients[index].staticField = "totalWeight";
    }

    // Track that this field was explicitly entered by the user
    if (key !== "name") {
      setUserEnteredFields(prev => ({
        ...prev,
        [`${index}-${key}`]: true
      }));
    }

    // Special handling for weight per bar & percentage in auto mode
    if (isNumBarsAuto && (key === "weightPerBar" || key === "percentage") && !isNaN(parseFloat(value))) {
      const numericValue = parseFloat(value);
      
      if (key === "weightPerBar") {
        // For weight per bar in auto mode, use iterative approach to find correct total weight
        const targetWeightPerBar = numericValue;
        
        // Step 1: Calculate percentage based on weight per bar / bar weight
        if (parseFloat(barWeight) > 0) {
          const calculatedPercentage = (targetWeightPerBar / parseFloat(barWeight)) * 100;
          newIngredients[index].percentage = formatValue(calculatedPercentage);
          
          console.log(`Auto-mode weightPerBar calculation:`, {
            targetWeightPerBar,
            calculatedPercentage,
            barWeight: parseFloat(barWeight)
          });
          
          // Step 2: Calculate what the total batch weight should be to achieve this percentage
          // We need to solve: targetWeightPerBar = (percentage / 100) * totalBatchWeight / numBars
          // Where: numBars = totalBatchWeight / barWeight
          // Substituting: targetWeightPerBar = (percentage / 100) * totalBatchWeight / (totalBatchWeight / barWeight)
          // Simplifying: targetWeightPerBar = (percentage / 100) * barWeight
          // So: totalBatchWeight = targetWeightPerBar * barWeight / (percentage / 100)
          
          // But we need to account for other ingredients' contributions
          const otherIngredientsWeight = ingredients.reduce((sum, ing, i) => {
            return i !== index ? sum + (parseFloat(ing.totalWeight) || 0) : sum;
          }, 0);
          
          // The total weight for this ingredient should be such that when added to other ingredients,
          // the resulting batch gives us the correct percentage
          // Let x = total weight for this ingredient
          // Then: targetWeightPerBar = x / (totalBatchWeight / barWeight)
          // Where: totalBatchWeight = otherIngredientsWeight + x
          // So: targetWeightPerBar = x / ((otherIngredientsWeight + x) / barWeight)
          // Solving: targetWeightPerBar * (otherIngredientsWeight + x) = x * barWeight
          // targetWeightPerBar * otherIngredientsWeight + targetWeightPerBar * x = x * barWeight
          // targetWeightPerBar * otherIngredientsWeight = x * (barWeight - targetWeightPerBar)
          // x = (targetWeightPerBar * otherIngredientsWeight) / (barWeight - targetWeightPerBar)
          
          let calculatedTotalWeight;
          if (Math.abs(parseFloat(barWeight) - targetWeightPerBar) > 0.001) {
            calculatedTotalWeight = (targetWeightPerBar * otherIngredientsWeight) / (parseFloat(barWeight) - targetWeightPerBar);
          } else {
            // Edge case: if weightPerBar equals barWeight (100%), use simple multiplication
            // In this case, this ingredient should be the entire batch
            calculatedTotalWeight = targetWeightPerBar * (otherIngredientsWeight / targetWeightPerBar + 1);
          }
          
          // Ensure positive value
          calculatedTotalWeight = Math.max(0, calculatedTotalWeight);
          
          console.log(`Calculated total weight for ingredient:`, {
            otherIngredientsWeight,
            calculatedTotalWeight
          });
          
          // Update the ingredient's total weight
          newIngredients[index].totalWeight = formatValue(calculatedTotalWeight);
          
          // Update total batch weight
          const newTotalBatchWeight = otherIngredientsWeight + calculatedTotalWeight;
          setTotalBatchWeight(newTotalBatchWeight);
          
        }
      } else if (key === "percentage") {
        // For percentage in auto mode, use simpler direct calculation based on current total batch weight
        const targetPercentage = numericValue;
        
        // Use the current total batch weight as base for calculation
        const currentTotalBatchWeight = parseFloat(totalBatchWeight) || 0;
        
        if (currentTotalBatchWeight > 0) {
          // Direct calculation based on current total weight and entered percentage
          const calculatedTotalWeight = (targetPercentage / 100) * currentTotalBatchWeight;
          
          console.log(`Auto-mode percentage calculation:`, {
            targetPercentage,
            currentTotalBatchWeight,
            calculatedTotalWeight
          });
          
          // Update the ingredient with new total weight
          newIngredients[index].totalWeight = formatValue(calculatedTotalWeight);
          
          // Calculate weight per bar based on current number of bars
          if (parseFloat(numBars) > 0) {
            const calculatedWeightPerBar = calculatedTotalWeight / parseFloat(numBars);
            newIngredients[index].weightPerBar = formatValue(calculatedWeightPerBar);
          }
        } else {
          // If total batch weight is zero, we can't calculate anything meaningful
          console.warn("Cannot calculate ingredient weight from percentage with zero total batch weight");
        }
      }
    } else if (!isNumBarsAuto && (key === "weightPerBar" || key === "percentage")) {
      // Non-auto mode calculations (existing logic)
      if (!isNaN(parseFloat(value))) {
        const numericValue = parseFloat(value);
        
        if (key === "weightPerBar" && newIngredients[index].staticField === "weightPerBar") {
          const calculatedTotalWeight = numericValue * numBars;
          newIngredients[index].totalWeight = formatValue(calculatedTotalWeight);
          
          // Calculate percentage based on weight per bar divided by bar weight
          if (barWeight > 0) {
            const calculatedPercentage = (numericValue / parseFloat(barWeight)) * 100;
            newIngredients[index].percentage = formatValue(calculatedPercentage);
          }
        } 
        else if (key === "percentage" && newIngredients[index].staticField === "percentage") {
          // ...existing code for percentage calculations...
          const calculatedTotalWeight = (numericValue / 100) * totalBatchWeight;
          newIngredients[index].totalWeight = formatValue(calculatedTotalWeight);
          
          const calculatedWeightPerBar = numBars > 0 
            ? (calculatedTotalWeight / numBars) 
            : 0;
          newIngredients[index].weightPerBar = formatValue(calculatedWeightPerBar);
        }
      }
    }
    
    // NEW: Special handling for totalWeight input
    if (key === "totalWeight" && !isNaN(parseFloat(value))) {
      const numericValue = parseFloat(value);
      
      // Add a debug log for totalWeight calculations
      if (index === 3) {
        console.log("Ingredient #4 totalWeight calculation:", {
          totalWeight: numericValue,
          numBars: parseFloat(numBars) || 0,
          calculatedWeightPerBar: numBars > 0 ? (numericValue / (parseFloat(numBars) || 1)) : 0
        });
      }
      
      // Set active edit field to prevent other calculations from overriding user input
      setActiveEditField({ index, field: key });
      
      // Keep the raw input value to prevent truncating multi-digit entries
      newIngredients[index].totalWeight = value;
      newIngredients[index].staticField = "totalWeight";
      
      if (isNumBarsAuto) {
        // Auto mode - calculate other values
        newIngredients[index].staticField = "totalWeight";
        
        // Calculate new total batch weight immediately 
        const oldWeight = parseFloat(ingredients[index].totalWeight) || 0;
        const otherWeights = ingredients.reduce((sum, ing, i) => {
          return i !== index ? sum + (parseFloat(ing.totalWeight) || 0) : sum;
        }, 0);
        const newTotalBatchWeight = otherWeights + numericValue;
        
        // Update total batch weight which will trigger bar count recalculation
        setTotalBatchWeight(newTotalBatchWeight);
      }
      // Calculate percentage based on weight per bar divided by bar weight
      if (numBars > 0 && barWeight > 0) {
        const calculatedWeightPerBar = numericValue / numBars;
        newIngredients[index].weightPerBar = formatValue(calculatedWeightPerBar);
        
        const calculatedPercentage = (calculatedWeightPerBar / parseFloat(barWeight)) * 100;
        newIngredients[index].percentage = formatValue(calculatedPercentage);
      }
      // ...rest of existing totalWeight handling...
    }
    
    setIngredients(newIngredients);
    
    // Clear active edit field after a short delay to allow other effects to run
    setTimeout(() => {
      setActiveEditField({ index: null, field: null });
      // Trigger recalculation of derived values
      setIngredientChangeTrigger(prev => !prev);
    }, 300);
  };

  const safelyParseFloat = (value) => {
    // Special case for numbers ending with a decimal point
    if (value.endsWith('.')) {
      return parseFloat(value + '0') / 10;
    }
    return parseFloat(value);
  };

  const handleStaticFieldChange = (index, field) => {
    const newIngredients = [...ingredients];
    newIngredients[index].staticField = field;
    setIngredients(newIngredients);
  };

  // Update the handleAutoPercentageChange function to preserve values when switching
  const handleAutoPercentageChange = (index) => {
    // Only proceed if we're selecting a different ingredient
    if (index === autoPercentageIndex) return;
    
    // Store the current ingredient values before switching
    const oldAutoIngredient = {...ingredients[autoPercentageIndex]};
    const newAutoIngredient = {...ingredients[index]};
    
    // Create a copy of ingredients to update
    const newIngredients = [...ingredients];
    
    // Preserve the values of the old auto-percentage ingredient
    // by converting its "auto-calculated" values to static values
    if (oldAutoIngredient.weightPerBar && oldAutoIngredient.percentage) {
      // Keep existing values, but set a static field so they won't be auto-calculated
      newIngredients[autoPercentageIndex] = {
        ...oldAutoIngredient,
        staticField: "weightPerBar" // Default to using weight per bar
      };
    }
    
    // Update the auto-percentage index
    setAutoPercentageIndex(index);
    
    // This will trigger the effect that recalculates all ingredient values
    // including the new auto-percentage ingredient
    setIngredients(newIngredients);
  };

  // --- Batch Management Functions ---
  const resetBatch = () => {
    setNumBars("");
    setBarWeight("");
    setBatchName("");
    setTotalBatchWeight(0);
    setIngredients(
      Array(5).fill().map(() => ({ name: "", weightPerBar: "", percentage: "", totalWeight: "", staticField: "weightPerBar" }))
    );
    setIsNumBarsAuto(false);
    setIsNumBarsUserEntered(false);
    setAutoUpdateIndex(null);
    setAutoPercentageIndex(0); // Reset to first ingredient

    // Also reset the user-entered fields tracking
    setUserEnteredFields({});
    setIsBarWeightUserSet(false); // Reset bar weight user set flag
    // Clear the current batch ID
    setCurrentBatchId(null);
  };

  // Update saveBatch function to handle updates vs new saves
  const saveBatch = async () => {
    if (!batchName) {
      alert("Please enter a batch name before saving.");
      return;
    }

    setIsLoading(true);
    setError(null);
    
    const batchData = {
      batchName,
      numBars,
      barWeight,
      totalBatchWeight,
      // Deep clone ingredients to avoid shared references
      ingredients: ingredients.map(ingredient => ({ ...ingredient })),
      isNumBarsAuto,  // Save auto-calc state for number of bars
      autoPercentageIndex,  // Save which ingredient is auto-calculated
    };
    
    try {
      if (currentBatchId) {
        // Check if the batch name matches the currently loaded batch
        const currentBatch = savedBatches.find(batch => batch.id === currentBatchId);
        if (currentBatch && currentBatch.batchName === batchName) {
          // Update existing batch
          const batchRef = doc(db, 'batches', currentBatchId);
          await updateDoc(batchRef, {
            ...batchData,
            updatedAt: new Date().toISOString()
          });
          
          // Update the local state with deep cloned data
          setSavedBatches(prevBatches => 
            prevBatches.map(batch => 
              batch.id === currentBatchId 
                ? { ...batch, ...batchData, updatedAt: new Date().toISOString() }
                : batch
            )
          );
          
          alert("Batch updated successfully!");
          return;
        }
      }
      
      // Create new batch (original logic)
      const newBatchData = {
        ...batchData,
        createdAt: new Date().toISOString()
      };
      
      const docRef = await addDoc(collection(db, 'batches'), newBatchData);
      const newBatch = { ...newBatchData, id: docRef.id };
      
      setSavedBatches(prevBatches => [...prevBatches, newBatch]);
      setCurrentBatchId(docRef.id); // Set the current batch ID
      alert("Batch saved successfully!");
      
    } catch (err) {
      console.error("Error saving batch:", err);
      setError("Failed to save batch");
      alert("Failed to save batch. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Update restoreBatch function to set the current batch ID
  const restoreBatch = (batch) => {
    if (batch) {
      setBatchName(batch.batchName);
      setNumBars(batch.numBars);
      setBarWeight(batch.barWeight);
      setTotalBatchWeight(batch.totalBatchWeight);
      // Deep clone the ingredients to avoid shared references
      setIngredients(batch.ingredients.map(ingredient => ({ ...ingredient })));
      
      // Restore auto-calculation states if they exist in the saved batch
      if (batch.hasOwnProperty('isNumBarsAuto')) {
        setIsNumBarsAuto(batch.isNumBarsAuto);
      } else {
        // Default to false for older saved batches that don't have this property
        setIsNumBarsAuto(false);
      }
      
      if (batch.hasOwnProperty('autoPercentageIndex')) {
        setAutoPercentageIndex(batch.autoPercentageIndex);
      } else {
        // Default to first ingredient for older saved batches
        setAutoPercentageIndex(0);
      }
      
      // Set the current batch ID to track which batch is loaded
      setCurrentBatchId(batch.id);
    }

    // Reset user-entered fields when loading a saved batch
    setUserEnteredFields({});
    setIsBarWeightUserSet(true); // Mark as set when loading a saved batch
  };

  // Update deleteBatch function to clear current batch ID if deleting current batch
  const deleteBatch = async (batchId) => {
    if (!window.confirm("Are you sure you want to delete this batch?")) {
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const batchRef = doc(db, 'batches', batchId);
      await deleteDoc(batchRef);
      setSavedBatches(prevBatches => prevBatches.filter(batch => batch.id !== batchId));
      
      // Clear current batch ID if we're deleting the currently loaded batch
      if (currentBatchId === batchId) {
        setCurrentBatchId(null);
      }
      
      alert("Batch deleted successfully!");
    } catch (err) {
      console.error("Error deleting batch:", err);
      setError("Failed to delete batch");
      alert("Failed to delete batch. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // --- Firebase Batch Management Functions ---
  // Load saved batches from Firebase when component mounts
  useEffect(() => {
    const fetchBatches = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const batchCollection = collection(db, 'batches');
        const batchSnapshot = await getDocs(batchCollection);
        
        const batchList = batchSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        setSavedBatches(batchList);
      } catch (err) {
        console.error("Error fetching batches:", err);
        setError("Failed to load saved batches");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBatches();
  }, []);

  // --- Auto-Calculate Logic Effects ---
  // Calculate number of bars in auto mode
  useEffect(() => {
    if (isNumBarsAuto && totalBatchWeight > 0 && barWeight > 0) {
      // Store original bar weight to make sure it's not changed
      const originalBarWeight = parseFloat(barWeight);
      
      // Calculate with precision to handle exact divisions correctly
      const exactDivision = totalBatchWeight / originalBarWeight;
      
      // When allowing decimal values, format to 2 decimal places for better precision
      const calculatedNumBars = parseFloat(exactDivision.toFixed(2));
      
      // Ensure we always have at least 0.01 bar
      const finalNumBars = Math.max(0.01, calculatedNumBars);
      
      if (!isNaN(finalNumBars) && Math.abs(finalNumBars - parseFloat(numBars)) > 0.01) {
        console.log(`Auto-updating number of bars: ${numBars} → ${finalNumBars} (totalBatchWeight: ${totalBatchWeight}, barWeight: ${originalBarWeight})`);
        setNumBars(finalNumBars);
        
        // When bar count changes, update total weight for ALL ingredients to maintain their weight per bar values
        setIngredients(prevIngredients => {
          const updated = prevIngredients.map((ingredient, index) => {
            const weightPerBar = parseFloat(ingredient.weightPerBar) || 0;
            
            // For ingredients with weightPerBar as static field OR user-entered, 
            // recalculate total weight to maintain the weight per bar value
            if (weightPerBar > 0 && (userEnteredFields[`${index}-weightPerBar`] || ingredient.staticField === "weightPerBar")) {
              const newTotalWeight = weightPerBar * finalNumBars;
              return {
                ...ingredient,
                totalWeight: formatValue(newTotalWeight)
              };
            }
            
            // For other ingredients, update weight per bar based on their total weight
            const totalWeight = parseFloat(ingredient.totalWeight) || 0;
            if (totalWeight > 0 && ingredient.staticField !== "weightPerBar" && !userEnteredFields[`${index}-weightPerBar`]) {
              return {
                ...ingredient,
                weightPerBar: formatValue(totalWeight / finalNumBars)
              };
            }
            
            return ingredient;
          });
          
          return updated;
        });
      }
    }
  }, [isNumBarsAuto, totalBatchWeight, barWeight, numBars, userEnteredFields]);

  // Update total batch weight in non-auto mode
  useEffect(() => {
    if (!isNumBarsAuto && numBars > 0 && barWeight > 0) {
      const calculatedTotalBatchWeight = parseFloat(numBars) * parseFloat(barWeight);
      const roundedTotalBatchWeight = Math.round(calculatedTotalBatchWeight);
      if (!isNaN(roundedTotalBatchWeight) && roundedTotalBatchWeight !== totalBatchWeight) {
        setTotalBatchWeight(roundedTotalBatchWeight);
      }
    }
  }, [numBars, barWeight, isNumBarsAuto, totalBatchWeight]);

  // Update ingredients when total batch weight or num bars changes in non-auto mode
  useEffect(() => {
    if (!isNumBarsAuto && numBars > 0 && barWeight > 0) {
      // Skip recalculation if user is actively editing
      if (activeEditField.index !== null) return;
      
      const calculatedTotalBatchWeight = parseFloat(numBars) * parseFloat(barWeight);
      
      // First calculate totals for all non-auto ingredients
      let totalPercentageExcludingAuto = 0;
      let totalWeightExcludingAuto = 0;
      
      ingredients.forEach((ingredient, idx) => {
        if (idx !== autoPercentageIndex) {
          // Calculate percentage for non-auto ingredients
          if (ingredient.staticField === "weightPerBar" && ingredient.weightPerBar) {
            const weightPerBar = parseFloat(ingredient.weightPerBar) || 0;
            const totalWeight = weightPerBar * numBars;
            if (totalWeight > 0) {
              totalPercentageExcludingAuto += (totalWeight / calculatedTotalBatchWeight) * 100;
              totalWeightExcludingAuto += totalWeight;
            }
          } else if (ingredient.staticField === "percentage" && ingredient.percentage) {
            const percentage = parseFloat(ingredient.percentage) || 0;
            if (percentage > 0) {
              totalPercentageExcludingAuto += percentage;
              totalWeightExcludingAuto += (percentage / 100) * calculatedTotalBatchWeight;
            }
          } else if (ingredient.staticField === "totalWeight" && ingredient.totalWeight) {
            // Add support for totalWeight as static field
            const totalWeight = parseFloat(ingredient.totalWeight) || 0;
            if (totalWeight > 0) {
              totalPercentageExcludingAuto += (totalWeight / calculatedTotalBatchWeight) * 100;
              totalWeightExcludingAuto += totalWeight;
            }
          }
        }
      });
      
      // Now update all ingredients including the auto-percentage one
      const updatedIngredients = ingredients.map((ingredient, index) => {
        // Handle auto-percentage ingredient differently
        if (index === autoPercentageIndex) {
          // Calculate remaining percentage (ensuring it's not negative)
          const remainingPercentage = Math.max(0, 100 - totalPercentageExcludingAuto);
          
          // Calculate weights based on the remaining percentage
          const autoTotalWeight = Math.max(0, calculatedTotalBatchWeight - totalWeightExcludingAuto);
          const autoWeightPerBar = numBars > 0 ? autoTotalWeight / numBars : 0;
          
          // Preserve the name when updating the auto ingredient
          return {
            ...ingredient,
            percentage: formatValue(remainingPercentage),
            totalWeight: formatValue(autoTotalWeight),
            weightPerBar: formatValue(autoWeightPerBar)
          };
        }
        
        // For non-auto ingredients, process normally
        const hasValidValues = (
          (ingredient.weightPerBar !== '' && !isNaN(parseFloat(ingredient.weightPerBar))) ||
          (ingredient.percentage !== '' && !isNaN(parseFloat(ingredient.percentage))) ||
          (ingredient.totalWeight !== '' && !isNaN(parseFloat(ingredient.totalWeight)))
        );
        
        if (!hasValidValues) return ingredient;
        
        const percentage = parseFloat(ingredient.percentage) || 0;
        const weightPerBar = parseFloat(ingredient.weightPerBar) || 0;
        const totalWeight = parseFloat(ingredient.totalWeight) || 0;
        
        if (percentage > 0 && ingredient.staticField === "percentage") {
          const totalWeight = (percentage / 100) * calculatedTotalBatchWeight;
          return {
            ...ingredient,
            totalWeight: !isNaN(totalWeight) ? totalWeight.toFixed(2) : "0",
            weightPerBar: numBars > 0 ? (totalWeight / numBars).toFixed(2) : "0",
          };
        }
        
        if (weightPerBar > 0 && ingredient.staticField === "weightPerBar") {
          const totalWeight = weightPerBar * numBars;
          return {
            ...ingredient,
            totalWeight: !isNaN(totalWeight) ? totalWeight.toFixed(2) : "0",
            percentage: parseFloat(barWeight) > 0
              ? ((weightPerBar / parseFloat(barWeight)) * 100).toFixed(2)
              : "0",
          };
        }
        
        if (totalWeight > 0 && ingredient.staticField === "totalWeight") {
          const calculatedWeightPerBar = numBars > 0 ? totalWeight / numBars : 0;
          return {
            ...ingredient,
            percentage: parseFloat(barWeight) > 0
              ? ((calculatedWeightPerBar / parseFloat(barWeight)) * 100).toFixed(2)
              : "0",
            weightPerBar: numBars > 0 ? (totalWeight / numBars).toFixed(2) : "0",
          };
        }
        
        return ingredient;
      });
      
      // Only update if there are actual changes
      if (JSON.stringify(updatedIngredients) !== JSON.stringify(ingredients)) {
        setIngredients(updatedIngredients);
      }
    }
  }, [numBars, barWeight, isNumBarsAuto, totalBatchWeight, ingredients, activeEditField, autoPercentageIndex]);

  // Auto-calculate total weight in auto mode
  useEffect(() => {
    if (isNumBarsAuto && totalBatchWeight > 0) {
      // Prevent unnecessary recalculations during typing
      if (activeEditField.index !== null) return;
      
      setIngredients((prevIngredients) => {
        const newIngredients = [...prevIngredients];
        newIngredients.forEach((ingredient, index) => {
          // Remove the index > 0 condition - all ingredients should be processed
          if (ingredient.staticField === "percentage" && ingredient.percentage) {
            const percentage = parseFloat(ingredient.percentage) || 0;
            const calculatedTotalWeight = (percentage / 100) * totalBatchWeight;
            
            if (calculatedTotalWeight > 0) {
              newIngredients[index].totalWeight = formatValue(calculatedTotalWeight);
              
              if (numBars > 0) {
                const calculatedWeightPerBar = calculatedTotalWeight / numBars;
                newIngredients[index].weightPerBar = formatValue(calculatedWeightPerBar);
              }
            }
          }
        });
        return newIngredients;
      });
    }
  }, [isNumBarsAuto, totalBatchWeight, numBars, activeEditField]);

  // Calculate weight per bar for ingredients based on percentage in auto mode
  useEffect(() => {
    if (isNumBarsAuto && totalBatchWeight > 0 && numBars > 0) {
      setIngredients((prevIngredients) => {
        const newIngredients = [...prevIngredients];
        let hasChanges = false;
        
        newIngredients.forEach((ingredient, index) => {
          // Skip if ingredient is being edited
          if (activeEditField.index === index) return;
          
          // Skip if this is a user-entered weightPerBar field OR if weightPerBar is the static field
          if (userEnteredFields[`${index}-weightPerBar`] || ingredient.staticField === "weightPerBar") {
            console.log(`Preserving weightPerBar for ingredient ${index + 1} (static field or user-entered)`);
            return;
          }
          
          const totalWeight = parseFloat(ingredient.totalWeight) || 0;
          
          if (index === 0 || ingredient.staticField === "percentage") {
            const calculatedWeightPerBar = totalWeight > 0 ? (totalWeight / numBars).toFixed(2) : "0";
            
            // Only update if value changed
            if (calculatedWeightPerBar !== ingredient.weightPerBar) {
              newIngredients[index].weightPerBar = calculatedWeightPerBar;
              hasChanges = true;
            }
          }
        });
        
        return hasChanges ? newIngredients : prevIngredients;
      });
    }
  }, [isNumBarsAuto, totalBatchWeight, numBars, activeEditField, userEnteredFields]);

  // Fix the auto-calculate checkbox handler and make sure it sets correct initial values
  const handleAutoCalculateChange = (e) => {
    const autoMode = e.target.checked;
    setIsNumBarsAuto(autoMode);
    
    if (autoMode) {
      setIsNumBarsUserEntered(false);
      
      console.log("Switching to auto mode, bar weight:", barWeight);
      
      const bwValue = parseFloat(barWeight); // Use the user-provided barWeight value
      
      if (bwValue > 0) {
        // Use barWeight as the default, giving us exactly 1 bar
        const initialBatchWeight = bwValue;
        console.log("Setting initial batch weight to:", initialBatchWeight);
        
        // Important: Update both state and ingredient in one batch
        setTotalBatchWeight(initialBatchWeight);
        setNumBars(1);
        
        // Directly set the first ingredient's total weight to match bar weight
        setIngredients(prev => {
          const updated = [...prev];
          updated[0] = {
            ...updated[0],
            totalWeight: bwValue.toString(),
            percentage: "100",
            weightPerBar: bwValue.toString(),
            staticField: "totalWeight" // Special staticField value for first ingredient in auto mode
          };
          return updated;
        });
      } else {
        // When no bar weight is set, initialize with blank values instead of 100g
        setTotalBatchWeight(0);
        setNumBars(0);
        
        // Clear the first ingredient's values to prevent default 100g calculation
        setIngredients(prev => {
          const updated = [...prev];
          updated[0] = {
            ...updated[0],
            totalWeight: "",
            percentage: "100", // Keep 100% but no weight
            weightPerBar: "",
            staticField: "totalWeight" // Special staticField value
          };
          return updated;
        });
      }
    } else {
      setNumBars(""); // Clear the value when auto mode is deselected
      
      // When switching to non-auto mode, recalculate based on bars and bar weight
      if (numBars > 0 && barWeight > 0) {
        setTotalBatchWeight(numBars * barWeight);
      }
    }
  };

  // Fix the effect that calculates the total batch weight in auto mode
  useEffect(() => {
    if (isNumBarsAuto && !activeEditField.index) {
      // Only recalculate when no active editing is happening
      const calculatedTotalBatchWeight = ingredients.reduce((sum, ingredient) => {
        const totalWeight = parseFloat(ingredient.totalWeight) || 0;
        return sum + totalWeight;
      }, 0);
      
      // Only update if there's a significant change
      if (Math.abs(calculatedTotalBatchWeight - parseFloat(totalBatchWeight)) > 0.01) {
        setTotalBatchWeight(calculatedTotalBatchWeight.toFixed(2));
      }
    }
  }, [isNumBarsAuto, ingredients, activeEditField]);

  // Remove special handling for first ingredient in auto mode
  useEffect(() => {
    if (isNumBarsAuto) {
      // We no longer modify the first ingredient's percentage automatically
      // Only recalculate totals based on ingredient input values
      const totalPercentage = ingredients.reduce((sum, ing) => {
        return sum + (parseFloat(ing.percentage) || 0);
      }, 0);
      
      // Show warning if ingredients exceed 100%
      if (totalPercentage > 100) {
        console.warn("Total percentage exceeds 100%:", totalPercentage);
      }
    }
  }, [isNumBarsAuto, ingredients]);

  // Update the effect for ingredient weights to handle all ingredients equally
  useEffect(() => {
    if (isNumBarsAuto && parseFloat(totalBatchWeight) > 0) {
      // Skip if actively editing
      if (activeEditField.index !== null) return;
      
      setIngredients(prevIngredients => {
        const newIngredients = [...prevIngredients];
        let hasChanges = false;
        
        // Calculate weights for all ingredients with percentage values
        newIngredients.forEach((ingredient, index) => {
          if (ingredient.staticField === "percentage") {
            const percentage = parseFloat(ingredient.percentage) || 0;
            if (percentage > 0) {
              const calculatedWeight = (percentage / 100) * totalBatchWeight;
              const newTotalWeight = formatValue(calculatedWeight);
              
              if (newTotalWeight !== ingredient.totalWeight) {
                newIngredients[index].totalWeight = newTotalWeight;
                
                // Also update weightPerBar only if it's not the static field
                if (numBars > 0 && ingredient.staticField !== "weightPerBar" && !userEnteredFields[`${index}-weightPerBar`]) {
                  const calculatedWeightPerBar = calculatedWeight / numBars;
                  newIngredients[index].weightPerBar = formatValue(calculatedWeightPerBar);
                }
                hasChanges = true;
              }
            }
          }
        });
        
        return hasChanges ? newIngredients : prevIngredients;
      });
    }
  }, [isNumBarsAuto, totalBatchWeight, numBars, activeEditField, userEnteredFields]);

  // Add a new effect to update percentages when an ingredient's total weight changes in auto mode
  useEffect(() => {
    if (isNumBarsAuto && totalBatchWeight > 0) {
      // Skip if user is actively editing
      if (activeEditField.index !== null && activeEditField.field === "totalWeight") return;
      
      setIngredients(prevIngredients => {
        const newIngredients = [...prevIngredients];
        let hasChanges = false;
        
        // Calculate percentages for all ingredients based on their weight per bar divided by bar weight
        newIngredients.forEach((ingredient, index) => {
          // Only update percentage automatically if it's NOT the static field
          if (ingredient.staticField !== "percentage") {
            const weightPerBar = parseFloat(ingredient.weightPerBar) || 0;
            if (weightPerBar > 0 && parseFloat(barWeight) > 0) {
              const calculatedPercentage = (weightPerBar / parseFloat(barWeight)) * 100;
              const formattedPercentage = formatValue(calculatedPercentage);
              
              if (formattedPercentage !== ingredient.percentage) {
                newIngredients[index].percentage = formattedPercentage;
                hasChanges = true;
              }
            }
          }
        });
        
        return hasChanges ? newIngredients : prevIngredients;
      });
    }
  }, [isNumBarsAuto, totalBatchWeight, activeEditField, barWeight]);

  // Add the effect for handling unit changes here, before the return statement
  useEffect(() => {
    // When unit changes, clear any active editing to prevent stale values
    setActiveEditField({ index: null, field: null });
    
    // Clear raw input cache when units change
    setRawTotalWeightInputs({});
  }, [weightUnit]);

  // --- Render UI ---
  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-center">Chocolate Batch Calculator</h1>
      <Card>
        <CardContent className="p-4 space-y-6">
          {/* Batch Information - now in a separate bordered box */}
          <div className="border-2 border-gray-300 rounded-md p-4 bg-gray-50">
            <h2 className="text-lg font-semibold mb-3">Batch Settings</h2>
            
            {/* Batch Name */}
            <div className="flex flex-col space-y-2 mb-3">
              <div className="flex items-center justify-between">
                <label className="block font-bold">Batch Name <span className="text-red-500">*</span></label>
              </div>
              <Input 
                type="text" 
                placeholder="Batch Name" 
                value={batchName} 
                onChange={(e) => setBatchName(e.target.value)} 
                required
                className={getInputStyle(false)}
              />
            </div>
            
            {/* Number of Bars - updated layout with checkbox next to label */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="block font-bold">Number of Bars {isNumBarsAuto ? null : <span className="text-red-500">*</span>}</label>
                <label className="flex items-center space-x-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isNumBarsAuto}
                    onChange={handleAutoCalculateChange}
                  />
                  <span>Auto-calc</span>
                </label>
              </div>
              <Input
                type="number"
                step="0.01"  // Change from 0.1 to 0.01 to allow two decimal places
                inputMode="decimal"  // Better for mobile keyboards
                placeholder="Number of Bars"
                value={numBars}
                onChange={(e) => {
                  setNumBars(e.target.value);
                  setIsNumBarsUserEntered(true);
                }}
                required={!isNumBarsAuto}
                disabled={isNumBarsAuto}
                className={getInputStyle(isNumBarsAuto)}
              />
            </div>
            
            {/* Bar Weight - Updated to emphasize it's a user-defined parameter */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="block font-bold">
                  Weight of Individual Bar (g) <span className="text-red-500">*</span>
                </label>
                <span className="text-sm text-blue-600 font-bold">User-defined only</span>
              </div>
              <Input
                type="number"
                placeholder="Bar Weight (g)"
                value={barWeight}
                onChange={(e) => setBarWeight(e.target.value)}
                required
                className={`${getInputStyle(false)} border-2 border-blue-500`} // Highlight this field
              />
              <p className="text-xs text-gray-500 mt-1">{BAR_WEIGHT_DESCRIPTION}</p>
            </div>

            {/* Move the Weight Unit Toggle here */}
            <div className="mb-3">
              <label className="block font-bold mb-1">Weight Unit</label>
              <div className="flex border rounded overflow-hidden">
                <button 
                  className={`flex-1 py-2 px-4 focus:outline-none ${weightUnit === "g" ? "bg-blue-500 text-white" : "bg-gray-100"}`}
                  onClick={() => setWeightUnit("g")}
                  type="button"
                >
                  Grams (g)
                </button>
                <button 
                  className={`flex-1 py-2 px-4 focus:outline-none ${weightUnit === "lbs" ? "bg-blue-500 text-white" : "bg-gray-100"}`}
                  onClick={() => setWeightUnit("lbs")}
                  type="button"
                >
                  Pounds (lbs)
                </button>
              </div>
            </div>

            {/* Total Batch Weight display is already using the formatWeightWithUnit function */}
            <div className="font-bold mt-3 text-center">
              {parseFloat(totalBatchWeight) > 0
                ? `Total Batch Weight: ${formatWeightWithUnit(totalBatchWeight)}`
                : "Total Weight: N/A"}
            </div>
          </div>
          
          {/* Ingredients List */}
          <div>
            <h2 className="text-lg font-semibold mb-2">Ingredients</h2>
            <ul className="space-y-4">
              {ingredients.map((ingredient, index) => (
                <li key={index} className="flex flex-col space-y-2">
                  {/* Add horizontal line between ingredients */}
                  {index > 0 && <hr className="border-gray-300 my-2" />}
                  
                  {/* Ingredient Name with numbering */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <label className="block font-bold">
                        Ingredient #{index + 1}
                      </label>
                      {ingredients.length > 1 && (
                        <Button 
                          onClick={() => removeIngredient(index)}
                          variant="destructive" 
                          size="sm"
                          disabled={!areMandatoryFieldsFilled()}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      {isNumBarsAuto && index === 0 ? (
                        <span className="text-sm text-gray-500 italic">Base ingredient</span>
                      ) : null}
                      {!isNumBarsAuto && (
                        <label className={`flex items-center space-x-2 ${getAutoCalcStyle(index === autoPercentageIndex)}`}>
                          <input
                            type="radio"
                            name="autoPercentageIngredient"
                            checked={autoPercentageIndex === index}
                            onChange={() => handleAutoPercentageChange(index)}
                            disabled={!areMandatoryFieldsFilled()}
                          />
                          <span className="text-sm">Auto-calc</span>
                        </label>
                      )}
                    </div>
                  </div>
                  <Input
                    type="text"
                    placeholder="Name"
                    value={ingredient.name}
                    onChange={(e) => updateIngredient(index, "name", e.target.value)}
                    disabled={!areMandatoryFieldsFilled()}
                    className={getInputStyle(!areMandatoryFieldsFilled())}
                  />
                  
                  {/* REORDERED: Percentage Input now comes first */}
                  <div>
                    <label className="block font-bold">
                      Percentage (%)
                      {ingredient.staticField === "percentage" && ingredient.percentage && 
                        // Don't show "used for calculation" text for auto-calculated ingredient in non-auto mode
                        !(!isNumBarsAuto && index === autoPercentageIndex) && 
                        <span className="ml-2 text-xs font-normal text-green-600">(used for calculation)</span>
                      }
                      {!isNaN(parseFloat(ingredient.percentage)) && parseFloat(ingredient.percentage) > 100 && 
                        <span className="ml-2 text-xs font-normal text-red-600">(exceeds 100%)</span>
                      }
                    </label>
                    <Input
                      type="number"
                      placeholder="Percentage (%)"
                      value={ingredient.percentage}
                      onChange={(e) => updateIngredient(index, "percentage", e.target.value)}
                      onFocus={() => setActiveEditField({ index, field: "percentage" })}
                      disabled={!areMandatoryFieldsFilled() || 
                              (isNumBarsAuto && index === 0) ||
                              (!isNumBarsAuto && index === autoPercentageIndex)} 
                      className={getPercentageInputStyle(
                        !areMandatoryFieldsFilled() || 
                        (isNumBarsAuto && index === 0) ||
                        (!isNumBarsAuto && index === autoPercentageIndex),
                        ingredient.percentage
                      )}
                    />
                  </div>
                  
                  {/* REORDERED: Weight Per Bar Input now comes second */}
                  <div>
                    <label className="block font-bold">
                      Weight/Bar (g)
                      {ingredient.staticField === "weightPerBar" && ingredient.weightPerBar && 
                        // Don't show "used for calculation" text for auto-calculated ingredient in non-auto mode
                        !(!isNumBarsAuto && index === autoPercentageIndex) &&
                        <span className="ml-2 text-xs font-normal text-green-600">(used for calculation)</span>
                      }
                    </label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="Weight per bar (g)"
                      value={ingredient.weightPerBar ?? ""}
                      onChange={(e) => {
                        // Mark this as a user-entered field when changed
                        updateIngredient(index, "weightPerBar", e.target.value);
                      }}
                      onFocus={() => {
                        setActiveEditField({ index, field: "weightPerBar" });
                        // Explicitly mark as user-entered when focused
                        setUserEnteredFields(prev => ({...prev, [`${index}-weightPerBar`]: true}));
                      }}
                      disabled={!areMandatoryFieldsFilled() || 
                              (isNumBarsAuto && index === 0) || 
                              (!isNumBarsAuto && index === autoPercentageIndex)}
                      className={getInputStyle(!areMandatoryFieldsFilled() || 
                              (isNumBarsAuto && index === 0) || 
                              (!isNumBarsAuto && index === autoPercentageIndex))}
                    />
                  </div>
                  
                  {/* Total Weight Input remains last */}
                  <div>
                    <label className="block font-bold">
                      Total Weight ({weightUnit})
                      {ingredient.staticField === "totalWeight" && 
                        !(!isNumBarsAuto && index === autoPercentageIndex) &&
                        <span className="ml-2 text-xs font-normal text-green-600">(used for calculation)</span>
                      }
                    </label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder={`Total Weight (${weightUnit})`}
                      value={
                        activeEditField.index === index && activeEditField.field === "totalWeight"
                          ? rawTotalWeightInputs[index] || ""
                          : gramsToSelectedUnit(ingredient.totalWeight) // Always use gramsToSelectedUnit for both units
                      }
                      onChange={(e) => {
                        // Store the raw input exactly as typed
                        const rawValue = e.target.value;
                        
                        // Always update raw input state
                        setRawTotalWeightInputs(prev => ({...prev, [index]: rawValue}));
                        
                        // Set this as active edit field
                        setActiveEditField({ index, field: "totalWeight" });
                        
                        // Always mark this as the static field for calculation
                        const newIngredients = [...ingredients];
                        newIngredients[index].staticField = "totalWeight";
                        
                        if (weightUnit === "g") {
                          // For grams, use the same logic as pounds - just store the raw value and defer calculations
                          if (rawValue && !isNaN(parseFloat(rawValue))) {
                            // For valid numeric input, convert to internal storage format (grams)
                            const gramValue = selectedUnitToGrams(rawValue); // This just returns rawValue for grams
                            
                            // Update the ingredient's total weight in grams (internal storage)
                            newIngredients[index].totalWeight = gramValue;
                            
                            // Calculate related values immediately (same as pounds logic)
                            if (numBars > 0) {
                              const numericGramValue = parseFloat(gramValue);
                              const calculatedWeightPerBar = numericGramValue / numBars;
                              newIngredients[index].weightPerBar = formatValue(calculatedWeightPerBar);
                            }
                            
                            if (totalBatchWeight > 0) {
                              const numericGramValue = parseFloat(gramValue);
                              // Calculate weight per bar first, then use new percentage formula
                              if (numBars > 0 && parseFloat(barWeight) > 0) {
                                const calculatedWeightPerBar = numericGramValue / numBars;
                                const calculatedPercentage = (calculatedWeightPerBar / parseFloat(barWeight)) * 100;
                                newIngredients[index].percentage = formatValue(calculatedPercentage);
                              }
                            }
                            
                            // Apply all changes at once
                            setIngredients(newIngredients);
                            
                            // Force immediate recalculation of batch totals and other ingredients
                            setTimeout(() => {
                              // Calculate new total batch weight immediately
                              if (isNumBarsAuto) {
                                const newTotalBatchWeight = newIngredients.reduce((sum, ing) => {
                                  return sum + (parseFloat(ing.totalWeight) || 0);
                                }, 0);
                                setTotalBatchWeight(newTotalBatchWeight);
                              }
                              
                              // Force update of other ingredients' values in auto mode
                              if (isNumBarsAuto && newIngredients.reduce((sum, ing) => sum + (parseFloat(ing.totalWeight) || 0), 0) > 0) {
                                const updatedTotalWeight = newIngredients.reduce((sum, ing) => sum + (parseFloat(ing.totalWeight) || 0), 0);
                                
                                const finalIngredients = newIngredients.map((ing, idx) => {
                                  // Skip the ingredient being edited
                                  if (idx === index) return ing;
                                  
                                  // Only update fields that are NOT the static field for this ingredient
                                  const updatedIng = { ...ing };
                                  
                                  // Update percentage only if it's not the static field
                                  if (ing.staticField !== "percentage") {
                                    const ingTotalWeight = parseFloat(ing.totalWeight) || 0;
                                    if (ingTotalWeight > 0) {
                                      const calculatedPercentage = (ingTotalWeight / updatedTotalWeight) * 100;
                                      updatedIng.percentage = formatValue(calculatedPercentage);
                                    }
                                  }
                                  
                                  // Update weight per bar only if it's not the static field AND not user-entered
                                  if (ing.staticField !== "weightPerBar" && !userEnteredFields[`${idx}-weightPerBar`]) {
                                    const ingTotalWeight = parseFloat(ing.totalWeight) || 0;
                                    if (ingTotalWeight > 0 && numBars > 0) {
                                      const calculatedWeightPerBar = ingTotalWeight / numBars;
                                      updatedIng.weightPerBar = formatValue(calculatedWeightPerBar);
                                    }
                                  }
                                  
                                  return updatedIng;
                                });
                                
                                setIngredients(finalIngredients);
                              }
                              
                              setIngredientChangeTrigger(prev => !prev);
                            }, 10);
                          } else {
                            // Handle empty or invalid input
                            updateIngredient(index, "totalWeight", "");
                          }
                        } else if (weightUnit === "lbs" && rawValue && !isNaN(parseFloat(rawValue))) {
                          // For pounds, we still need to handle raw input but also trigger calculations
                          // Convert to grams for internal storage
                          const gramValue = selectedUnitToGrams(rawValue);
                          
                          // Update the ingredient's total weight in grams (internal storage)
                          newIngredients[index].totalWeight = gramValue;
                          
                          // Calculate related values immediately
                          if (numBars > 0) {
                            const numericGramValue = parseFloat(gramValue);
                            const calculatedWeightPerBar = numericGramValue / numBars;
                            newIngredients[index].weightPerBar = formatValue(calculatedWeightPerBar);
                          }
                          
                          if (totalBatchWeight > 0) {
                            const numericGramValue = parseFloat(gramValue);
                            // Calculate weight per bar first, then use new percentage formula  
                            if (numBars > 0 && parseFloat(barWeight) > 0) {
                              const calculatedWeightPerBar = numericGramValue / numBars;
                              const calculatedPercentage = (calculatedWeightPerBar / parseFloat(barWeight)) * 100;
                              newIngredients[index].percentage = formatValue(calculatedPercentage);
                            }
                          }
                          
                          // Apply all changes at once
                          setIngredients(newIngredients);
                          
                          // Force immediate recalculation of batch totals and other ingredients
                          setTimeout(() => {
                            // Calculate new total batch weight immediately
                            if (isNumBarsAuto) {
                              const newTotalBatchWeight = newIngredients.reduce((sum, ing) => {
                                return sum + (parseFloat(ing.totalWeight) || 0);
                              }, 0);
                              setTotalBatchWeight(newTotalBatchWeight);
                            }
                            
                            // Force update of other ingredients' percentages in auto mode
                            if (isNumBarsAuto && newIngredients.reduce((sum, ing) => sum + (parseFloat(ing.totalWeight) || 0), 0) > 0) {
                              const updatedTotalWeight = newIngredients.reduce((sum, ing) => sum + (parseFloat(ing.totalWeight) || 0), 0);
                              
                              const finalIngredients = newIngredients.map((ing, idx) => {
                                // Only update if this ingredient is NOT the one being edited AND it's not using percentage as static field
                                if (idx !== index && ing.staticField !== "percentage") {
                                  const ingTotalWeight = parseFloat(ing.totalWeight) || 0;
                                  if (ingTotalWeight > 0 && numBars > 0 && parseFloat(barWeight) > 0) {
                                    const ingWeightPerBar = ingTotalWeight / numBars;
                                    const calculatedPercentage = (ingWeightPerBar / parseFloat(barWeight)) * 100;
                                    return {
                                      ...ing,
                                      percentage: formatValue(calculatedPercentage)
                                    };
                                  }
                                }
                                return ing;
                              });
                              
                              setIngredients(finalIngredients);
                            }
                            
                            setIngredientChangeTrigger(prev => !prev);
                          }, 10);
                        } else {
                          // Handle empty or invalid input
                          updateIngredient(index, "totalWeight", "");
                        }
                      }}
                      onBlur={() => {
                        // On blur, ensure any final conversions are done properly
                        if (weightUnit === "lbs") {
                          const currentRawValue = rawTotalWeightInputs[index];
                          
                          if (currentRawValue !== undefined && currentRawValue !== "" && !isNaN(parseFloat(currentRawValue))) {
                            const gramValue = selectedUnitToGrams(currentRawValue);
                            // Use updateIngredient to ensure all side effects happen
                            updateIngredient(index, "totalWeight", gramValue);
                          } else if (currentRawValue === "" || isNaN(parseFloat(currentRawValue))) {
                            // Handle empty/invalid input - ensure cascading deletion happens
                            updateIngredient(index, "totalWeight", "");
                          }
                        }
                        
                        // Clear active edit field after processing completes
                        setTimeout(() => {
                          if (activeEditField.index === index && activeEditField.field === "totalWeight") {
                            setActiveEditField({ index: null, field: null });
                          }
                        }, 100);
                      }}
                      onFocus={() => {
                        setActiveEditField({ index, field: "totalWeight" });
                        
                        // Initialize raw input with the current displayed value
                        if (weightUnit === "lbs" && ingredient.totalWeight) {
                          setRawTotalWeightInputs(prev => ({
                            ...prev, 
                            [index]: gramsToSelectedUnit(ingredient.totalWeight)
                          }));
                        } else {
                          // For grams mode, use the formatted display value to match what the user sees
                          setRawTotalWeightInputs(prev => ({
                            ...prev, 
                            [index]: gramsToSelectedUnit(ingredient.totalWeight) || ""
                          }));
                        }
                        
                        // Set this field as the static field for calculations
                        const newIngredients = [...ingredients];
                        newIngredients[index].staticField = "totalWeight";
                        setIngredients(newIngredients);
                      }}
                      disabled={!areMandatoryFieldsFilled() || (!isNumBarsAuto && index === autoPercentageIndex)}
                      className={getInputStyle(!areMandatoryFieldsFilled() || (!isNumBarsAuto && index === autoPercentageIndex))}
                    />
                  </div>
                </li>
              ))}
            </ul>
            
            {/* Add Ingredient Button */}
            <div className="mt-4 flex justify-center">
              <Button 
                onClick={addIngredient}
                variant="secondary"
                className="bg-green-500 hover:bg-green-600 focus:ring-green-500"
                disabled={!areMandatoryFieldsFilled()}
              >
                + Add Ingredient
              </Button>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex space-x-4 mt-4">
            <Button onClick={() => saveBatch()} disabled={isLoading}>
              {isLoading ? "Saving..." : "Save Batch"}
            </Button>
            <Button onClick={() => resetBatch()} variant="secondary" disabled={isLoading}>Reset Batch</Button>
          </div>
          
          {/* Saved Batches Section */}
          <div className="mt-6">
            <h2 className="text-lg font-semibold">Saved Batches</h2>
            {error && <p className="text-red-500">{error}</p>}
            {isLoading && <p>Loading batches...</p>}
            {!isLoading && savedBatches.length > 0 ? (
              <ul className="space-y-2">
                {savedBatches.map((batch) => (
                  <li key={batch.id} className="flex items-center justify-between border-b pb-2">
                    <span>{batch.batchName}</span>
                    <div className="flex space-x-2">
                      <Button onClick={() => restoreBatch(batch)} variant="secondary" size="sm">Restore</Button>
                      <Button onClick={() => deleteBatch(batch.id)} variant="destructive" size="sm">Delete</Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : !isLoading && (
              <p>No saved batches yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

