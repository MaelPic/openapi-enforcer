/**
 *  @license
 *    Copyright 2018 Brigham Young University
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 **/
'use strict';
const Exception         = require('../exception');
const util              = require('../util');

/**
 * Merge multiple schemas and validate the final schema.
 * @param {Schema[]} schemas
 * @param {object} [options]
 * @param {boolean} [options.overwriteDiscriminator=false] Set to true to allow conflicting discriminators to overwrite the previous, otherwise causes exceptions.
 * @returns {{ error: Exception|null, value:object }}
 */
module.exports = (schemas, options) => {
    const exception = Exception('Unable to merge schemas');

    options = Object.assign({}, options);

    // check that each schema is valid
    let valid = true;
    schemas.forEach((schema, index) => {
        const error = schema.exception();
        if (error) {
            valid = false;
            const child = exception.nest('One or more errors with schema at index ' + index);
            child(error);
        }
    });
    if (!value) return { error: exception, value: null };

    const merged = merge(exception, version, schemas, options, new Map());
    const hasException = exception.hasException;
    return {
        error: hasException ? exception : null,
        value: hasException ? null : merged
    }
};

function merge(exception, version, schemas, options, map) {
    const length = schemas.length;
    const result = { type: (schemas[0] && schemas[0].type) || {} };

    // watch for cyclic merging
    const existing = map.get(schemas);
    if (existing) return existing;
    map.set(schemas, result);

    for (let index = 0; index < length; index++) {
        const schema = schemas[index];
        if (!schema) continue;

        // merge all schemas and then reprocess this schema
        if (schema.allOf) {
            schemas[index] = merge(exception.nest('allOf'), version, schema.allOf, options, map);
            index--;

        } else if (schema.anyOf || schema.oneOf || schema.not) {
            exception('Cannot merge the modifiers anyOf, oneOf, or not');

        } else {
            // validate types match
            let type = schema.type;
            if (type === 'integer' && result.type === 'number') result.type = 'integer';
            if (type === 'number' && result.type === 'integer') type = 'integer';
            if (type !== result.type) {
                exception('Incompatible types: ' + schema.type + ' and ' + result.type);
                continue;
            }

            // validate formats match
            let format = schema.format;
            if (format && !result.format) result.format = format;
            if (format !== result.format) {
                exception('Incompatible formats: ' + schema.format + ' and ' + result.format);
                continue;
            }

            switch(result.type) {
                case 'array':
                    if (schema.hasOwnProperty('maxItems')) result.maxItems = lowestNumber(schema.maxItems, result.maxItems);
                    if (schema.hasOwnProperty('minItems')) result.minItems = highestNumber(schema.minItems, result.minItems);
                    if (schema.uniqueItems) result.uniqueItems = true;
                    if (schema.items) result.items = merge(exception.nest('items'), version, [schema.items, result.items], options, map);
                    break;

                case 'boolean':
                    if (schema.hasOwnProperty('default')) result.default = schema.default;
                    break;

                case 'integer':
                case 'number':
                    if (schema.hasOwnProperty('maximum')) result.maximum = lowestNumber(schema.maximum, result.maximum);
                    if (schema.hasOwnProperty('minimum')) result.minimum = highestNumber(schema.minimum, result.minimum);
                    if (schema.exclusiveMaximum) result.exclusiveMaximum = true;
                    if (schema.exclusiveMinimum) result.exclusiveMinimum = true;
                    if (schema.hasOwnProperty('multipleOf')) {
                        result.multipleOf = result.multipleOf
                            ? leastCommonMultiple(result.multipleOf, schema.multipleOf)
                            : schema.multipleOf;
                    }
                    break;

                case 'object':
                    if (schema.hasOwnProperty('maxProperties')) result.maxProperties = lowestNumber(schema.maxProperties, result.maxProperties);
                    if (schema.hasOwnProperty('minProperties')) result.minProperties = highestNumber(schema.minProperties, result.minProperties);
                    if (schema.hasOwnProperty('required')) {
                        if (!result.required) {
                            result.required = schema.required.concat();
                        } else {
                            result.required = util.arrayUnique(result.required.concat(schema.required));
                        }
                    }
                    if (schema.discriminator) {
                        if (!result.discriminator || options.overwriteDiscriminator) {
                            result.discriminator = schema.discriminator;
                        } else {
                            exception('Cannot merge objects with competing discriminators (unless option.overwriteDiscriminator is set to true)');
                        }
                    }
                    if (schema.properties) {
                        if (!result.properties) result.properties = {};
                        Object.keys(schema.properties).forEach(key => {
                            result.properties[key] = merge(exception.nest('Could not merge "properties" key: ' + key),
                                version, [schema.properties[key], result.properties[key]], options, map);
                        })
                    }
                    if (schema.additionalProperties) {
                        if (!result.additionalProperties || result.additionalProperties === true) {
                            result.additionalProperties = schema.additionalProperties
                        } else {
                            result.additionalProperties = merge(exception.nest('Could not merge additionalProperties'),
                                version, [result.additionalProperties, schema.additionalProperties], options, map);
                        }

                    }
                    break;

                case 'string':
                    if (format === 'date' || format === 'date-time') {
                        if (schema.hasOwnProperty('maximum')) result.maximum = lowestNumber(schema.maximum, result.maximum);
                        if (schema.hasOwnProperty('minimum')) result.minimum = lowestNumber(schema.minimum, result.minimum);
                    }
                    if (schema.hasOwnProperty('maxLength')) result.maxLength = lowestNumber(schema.maxLength, result.maxLength);
                    if (schema.hasOwnProperty('minLength')) result.minLength = highestNumber(schema.minLength, result.minLength);
                    if (schema.hasOwnProperty('pattern')) {
                        if (!result.hasOwnProperty('pattern')) {
                            result.pattern = rxStringToRx(schema.pattern);
                        } else if (result.pattern !== schema.pattern) {
                            result.pattern = rxMerge(result.pattern, schema.pattern);
                        }
                    }
                    break;
            }

            if (schema.hasOwnProperty('default')) result.default = schema.default;
        }
    }

    return result;
}





