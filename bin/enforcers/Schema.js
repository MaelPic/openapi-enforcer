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
const EnforcerRef       = require('../enforcer-ref');
const Exception         = require('../exception');
const Result            = require('../result');
const runDeserialize    = require('../schema/deserialize');
const runPopulate       = require('../schema/populate');
const runSerialize      = require('../schema/serialize');
const util              = require('../util');
const Value             = require('../value');

const rxHttp = /^https?:\/\//;
const populateInjectors = {
    colon: buildInjector(() => /:([_$a-z][_$a-z0-9]*)/ig),
    doubleHandlebar: buildInjector(() => /{{([_$a-z][_$a-z0-9]*)}}/ig),
    handlebar: buildInjector(() => /{([_$a-z][_$a-z0-9]*)}/ig)
};

const prototype = {

    /**
     * Take a serialized (ready for HTTP transmission) value and deserialize it.
     * Converts strings of binary, byte, date, and date-time to JavaScript equivalents.
     * @param {*} value
     * @returns {{ error: Exception|null, value: * }}
     */
    deserialize: function(value) {
        const exception = Exception('Unable to deserialize value');
        const result = runDeserialize(exception, new Map(), this, util.copy(value));
        return new Result(result, exception);
    },

    /**
     * Get discriminator key and schema.
     * @param {*} value
     * @returns {Schema }
     */
    discriminate: function (value) {
        const { major, root } = this.enforcerData;
        const discriminator = this.discriminator;
        const openapi = root.result;
        if (major === 2) {
            const key = discriminator && value && value.hasOwnProperty(discriminator) ? value[discriminator] : undefined;
            if (!key) return undefined;
            return openapi.definitions && openapi.definitions[key];

        } else if (major === 3) {
            let key = discriminator && value && value.hasOwnProperty(discriminator.propertyName) ? value[discriminator.propertyName] : undefined;
            if (!key) return undefined;

            // if there is a mapping then use mapping result
            const mapping = discriminator.mapping;
            if (mapping && mapping.hasOwnProperty(key)) return mapping[key];

            // if no mapping then look at global schemas
            return openapi.components && openapi.components.schemas && openapi.components.schemas[key];
        }
    },

    /**
     * Populate a value from a list of parameters.
     * @param {object} [params]
     * @param {*} [value]
     * @param {object} [options]
     * @param {boolean} [options.copy=false]
     * @param {boolean} [options.conditions=true]
     * @param {boolean} [options.defaults=true]
     * @param {number} [options.depth=100]
     * @param {string} [options.replacement='handlebar']
     * @param {boolean} [options.templateDefaults=true]
     * @param {boolean} [options.templates=true]
     * @param {boolean} [options.variables=true]
     * @returns {{ error: Exception|null, value: * }}
     */
    populate: function(params, value, options) {
        if (params === undefined || params === null) params = {};
        if (!params || !util.isPlainObject(params)) throw Error('Invalid params specified. Must be a plain object');

        if (arguments.length < 3) options = {};
        if (!options || !util.isPlainObject(options)) throw Error('Invalid options specified. Must be a plain object');
        if (!options.hasOwnProperty('copy')) options.copy = false;
        if (!options.hasOwnProperty('conditions')) options.conditions = true;
        if (!options.hasOwnProperty('defaults')) options.defaults = true;
        if (!options.hasOwnProperty('depth')) options.depth = 100;
        if (!options.hasOwnProperty('replacement')) options.replacement = 'handlebar';
        if (!options.hasOwnProperty('templateDefaults')) options.templateDefaults = true;
        if (!options.hasOwnProperty('templates')) options.templates = true;
        if (!options.hasOwnProperty('variables')) options.variables = true;

        if (!util.isInteger(options.depth) || options.depth < 0) {
            throw Error('Invalid depth specified. Expected a non-negative integer');
        }
        if (!populateInjectors.hasOwnProperty(options.replacement)) {
            throw Error('Invalid replacement type specified. Expected one of: ' + Object.keys(populateInjectors).join(', '));
        }

        options.injector = populateInjectors[options.replacement];
        if (!params) params = {};
        if (options.copy) value = util.copy(value);
        const root = { value };

        // validate the value
        const exception = Exception('Unable to populate value');
        const warn = Exception('One or more warnings found while populating value');
        runPopulate(exception, warn, options.depth - 1, this, params, root, 'value', options);

        return new Result(root.value, exception, warn);
    },

    /**
     * Produce a random value for the schema.
     * @param {*} value An initial value to add random values to.
     * @param {object} [options]
     * @param {boolean} [options.skipInvalid=false]
     * @param {boolean} [options.throw=true]
     * @returns {{ error: Exception|null, value: * }}
     */
    random: function(value, options) {
        //return random(this, value, options);
    },

    /**
     * Take a deserialized (not ready for HTTP transmission) value and serialize it.
     * Converts Buffer and Date objects into string equivalent.
     * @param value
     * @returns {*}
     */
    serialize: function (value) {
        const exception = Exception('Unable to serialize value');
        const result = runSerialize(exception, new Map(), this, value);
        return new Result(result, exception);
    },

    /**
     * Check to see if the value is valid for this schema.
     * @param {*} value
     * @returns {Exception|undefined}
     */
    validate: function(value) {
        const exception = Exception('Invalid value');
        runValidate(exception, new Map(), this, value, {});
        if (exception.hasException) return exception;
    }
};

module.exports = {
    init: function (data) {
        const { exception, major, plugins, refParser, staticData, warn } = data;

        // deserialize and validate enum, default, and example
        if (this.hasOwnProperty('enum')) {
            const child = exception.at('enum');
            const value = this.enum.map((value, index) => {
                return deserializeAndValidate(this, child.at(index), value, { enum: false });
            });
            Object.freeze(value);
            setProperty(this, 'enum', value);
        }
        if (this.hasOwnProperty('default')) {
            const value = deserializeAndValidate(this, exception.at('default'), this.default, {});
            setProperty(this, 'default', freeze(value));
        }
        if (this.hasOwnProperty('example')) {
            const value = deserializeAndValidate(this, warn.at('example'), this.example, {});
            setProperty(this, 'example', freeze(value));
        }

        // run data type validator
        const dataTypes = staticData.dataTypes;
        const dataType = (dataTypes && dataTypes[this.type] && dataTypes[this.type][this.format]) || null;
        if (dataType && dataType.validator) dataType.validator.call(this, data);

        // if there is a discriminator with mappings then resolve those references
        const discriminator = this.discriminator;
        if (major === 3 && refParser && discriminator && discriminator.mapping) {
            plugins.push(() => {
                const instanceMap = this.enforcerData.defToInstanceMap;
                Object.keys(discriminator.mapping).forEach(key => {
                    const value = discriminator.mapping[key];
                    const ref = rxHttp.test(value) || value.indexOf('/') !== -1
                        ? value
                        : '#/components/schemas/' + value;
                    const definition = refParser.$refs.get(ref);
                    setProperty(discriminator.mapping, key, instanceMap.get(definition));
                });
            });
        }
    },

    prototype,

    statics: function (scope) {
        const dataTypes = scope.dataTypes = {
            boolean: {},
            integer: {},
            number: {},
            string: {}
        };
        return {
            defineDataTypeFormat: function (type, format, definition) {
                // validate input parameters
                if (!dataTypes.hasOwnProperty(type)) throw Error('Invalid type specified. Must be one of: ' + Object.keys(dataTypes).join(', '));
                if (!format || typeof format !== 'string') throw Error('Invalid format specified. Must be a non-empty string');
                if (dataTypes.hasOwnProperty(format)) throw Error('Format "' + format + '" is already defined');
                if (!definition || typeof definition !== 'object' ||
                    typeof definition.deserialize !== 'function' ||
                    typeof definition.serialize !== 'function' ||
                    typeof definition.validate !== 'function'
                    || (definition.random &&  typeof definition.random !== 'function')) throw Error('Invalid data type definition. Must be an object that defines handlers for "deserialize", "serialize", and "validate" with optional "random" handler.');

                // store the definition
                dataTypes[type][format] = Object.assign({}, definition, { type, format });
            }
        }
    },

    validator: function (data) {
        const { major } = data;

        const exclusive = {
            allowed: ({ parent }) => {
                return numericish(parent.result);
            },
            type: 'boolean'
        };

        const maxOrMin = {
            weight: -8,
            allowed: ({ parent }) => numericish(parent.result),
            type: ({ parent }) => numericType(parent.result),
            deserialize: ({ exception, parent, result }) => {
                const value = runDeserialize(exception, new Map(), parent.result, result);
                return exception.hasException ? result : value;
            },
            errors: ({ exception, parent, result }) => {
                runValidate(exception, new Map(), parent.result, result, { maxMin: false })
            }
        };

        const maxOrMinItems = {
            allowed: ({ parent }) => parent.definition.type === 'array',
            type: 'number',
            errors: ({ exception, result }) => {
                if (!util.isInteger(result) || result < 0) {
                    exception.message('Value must be a non-negative integer');
                }
            }
        };

        const maxOrMinLength = {
            allowed: ({ parent }) => parent.definition.type === 'string' && !numericish(parent.result),
            type: 'number',
            errors: ({ exception, result }) => {
                if (!util.isInteger(result) || result < 0) {
                    exception.message('Value must be a non-negative integer');
                }
            }
        };

        const maxOrMinProperties = {
            allowed: ({ parent }) => parent.definition.type === 'object',
            type: 'number',
            errors: ({ exception, result }) => {
                if (!util.isInteger(result) || result < 0) {
                    exception.message('Value must be a non-negative integer');
                }
            }
        };

        return {
            type: 'object',
            properties: {
                additionalProperties: EnforcerRef('Schema', {
                    allowed: ({parent}) => parent.definition.type === 'object',
                    type: ['boolean', 'object'],    // either boolean or object
                    default: true
                }),
                allOf: {
                    type: 'array',
                    items: EnforcerRef('Schema')
                },
                anyOf: {
                    allowed: ({major}) => major === 3,
                    type: 'array',
                    items: EnforcerRef('Schema')
                },
                default: {
                    type: ({ parent }) => parent.definition.type
                },
                deprecated: {
                    allowed: ({major}) => major === 3,
                    type: 'boolean',
                    default: false
                },
                description: {
                    type: 'string'
                },
                discriminator: {
                    allowed: ({ parent }) => {
                        return parent && parent.validator === module.exports.validator &&
                            (parent.definition.type === 'object' || parent.definition.anyOf || parent.definition.oneOf);
                    },
                    type: ({ major }) => major === 2 ? 'string' : 'object',
                    properties: {
                        propertyName: {
                            type: 'string',
                            required: true,
                            errors: ({ definition, parent }) => {
                                const def = parent.parent.definition;
                                if (def.type === 'object' && (!def.required || !def.required.includes(definition))) {
                                    parent.parent.exception.message('Property "' + definition + '" must be required because it is used as the discriminator property')
                                }
                            }
                        },
                        mapping: {
                            type: 'object',
                            additionalProperties: {
                                type: 'string',
                                errors: ({ exception, key, parent, refParser, result }) => {
                                    if (refParser) {
                                        let schema;
                                        try {
                                            const ref = rxHttp.test(result) || result.indexOf('/') !== -1
                                                ? result
                                                : '#/components/schemas/' + result;
                                            schema = refParser.$refs.get(ref)
                                        } catch (err) {
                                            exception.message('Reference cannot be resolved: ' + result);
                                        }

                                        if (schema) {
                                            const def = parent.parent.parent.definition;
                                            if (def.anyOf && !def.anyOf.includes(schema)) {
                                                exception.message('Mapping reference must exist in anyOf: ' + result);
                                            } else if (def.oneOf && !def.oneOf.includes(schema)) {
                                                exception.message('Mapping reference must exist in oneOf: ' + result);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    errors: ({ exception, major, parent, definition }) => {
                        if (major === 2) {
                            if (!parent.definition.required || !parent.definition.required.includes(definition)) {
                                exception.message('Value "' + definition + '" must be found in the parent\'s required properties list.');
                            }
                            if (!parent.definition.properties || !parent.definition.properties.hasOwnProperty(definition)) {
                                exception.message('Value "' + definition + '" must be found in the parent\'s properties definition.');
                            }

                        } else if (major === 3 && definition.hasOwnProperty('propertyName') && definition.type === 'object') {
                            if (!parent.definition.required || !parent.definition.required.includes(definition.propertyName)) {
                                exception.message('Value "' + definition.propertyName + '" must be found in the parent\'s required properties list.');
                            }
                            if (!parent.definition.properties || !parent.definition.properties.hasOwnProperty(definition.propertyName)) {
                                exception.message('Value "' + definition.propertyName + '" must be found in the parent\'s properties definition.');
                            }
                        }
                    }
                },
                enum: {
                    weight: -7,
                    type: 'array',
                    items: {
                        allowed: ({ parent }) => !!(parent && parent.parent),
                        type: ({ parent }) => parent.parent.definition.type,
                        freeForm: true
                    }
                },
                example: {
                    allowed: true,
                    freeForm: true
                },
                exclusiveMaximum: exclusive,
                exclusiveMinimum: exclusive,
                externalDocs: EnforcerRef('ExternalDocumentation'),
                format: {
                    weight: -9,
                    allowed: ({ parent }) => ['integer', 'number', 'string'].includes(parent.definition.type),
                    type: 'string',
                    errors: ({ exception, parent, warn }) => {
                        const format = parent.definition.format;
                        if (format) {
                            const enums = [];
                            switch (parent.definition.type) {
                                case 'integer': enums.push('int32', 'int64'); break;
                                case 'number': enums.push('float', 'double'); break;
                                case 'string': enums.push('binary', 'byte', 'date', 'date-time', 'password');
                            }
                            if (!enums.includes(format)) warn.message('Non standard format used: ' + format);
                        }
                    }
                },
                items: EnforcerRef('Schema', {
                    allowed: ({parent}) => {
                        return parent.definition.type === 'array'
                    },
                    required: ({ parent }) => parent.definition.type === 'array'
                }),
                maximum: maxOrMin,
                maxItems: maxOrMinItems,
                maxLength: maxOrMinLength,
                maxProperties: maxOrMinProperties,
                minimum: maxOrMin,
                minItems: maxOrMinItems,
                minLength: maxOrMinLength,
                minProperties: maxOrMinProperties,
                multipleOf: {
                    allowed: ({ parent }) => ['integer', 'number'].includes(parent.definition.type),
                    type: 'number'
                },
                not: EnforcerRef('Schema', { allowed: major === 3 }),
                nullable: {
                    allowed: ({major}) => major === 3,
                    type: 'boolean',
                    default: false
                },
                oneOf: {
                    allowed: ({major}) => major === 3,
                    type: 'array',
                    items: EnforcerRef('Schema')
                },
                pattern: {
                    allowed: ({ parent }) => parent.definition.type === 'string',
                    type: 'string',
                    deserialize: ({ exception, result }) => {
                        if (!result) {
                            exception.message('Value must be a non-empty string');
                            return /./;
                        } else {
                            return new RegExp(result);
                        }
                    },
                    errors: ({ exception, result }) => {
                        if (!result) exception.message('Value must be a non-empty string');
                    }
                },
                properties: {
                    allowed: ({parent}) => parent.definition.type === 'object',
                    type: 'object',
                    additionalProperties: EnforcerRef('Schema')
                },
                readOnly: {
                    allowed: isSchemaProperty,
                    type: 'boolean',
                    default: false,
                    errors: ({ major, parent, definition }) => {
                        if (major === 2 && definition && parent && parent.parent && parent.parent.parent && parent.parent.parent.definition.required && parent.parent.parent.definition.required.includes(parent.key)) {
                            parent.warn.message('Property should not be marked as both read only and required');
                        }
                    }
                },
                required: {
                    allowed: ({parent}) => parent.definition.type === 'object',
                    type: 'array',
                    items: 'string'
                },
                title: 'string',
                type: {
                    weight: -10,
                    type: 'string',
                    required: ({ parent }) => {
                        const v = parent.definition;
                        return !v.hasOwnProperty('allOf') && !v.hasOwnProperty('anyOf') &&
                            !v.hasOwnProperty('not') && !v.hasOwnProperty('oneOf');
                    },
                    enum: ['array', 'boolean', 'integer', 'number', 'object', 'string']
                },
                uniqueItems: {
                    allowed: ({parent}) => parent.definition.type === 'array',
                    type: 'boolean'
                },
                writeOnly: {
                    allowed: (data) => data.major === 3 && !!isSchemaProperty(data),
                    type: 'boolean',
                    default: false
                },
                xml: EnforcerRef('Xml')
            },

            errors: (data) => {
                const { exception, result } = data;

                if (!minMaxValid(result.minItems, result.maxItems)) {
                    exception.message('Property "minItems" must be less than or equal to "maxItems"');
                }

                if (!minMaxValid(result.minLength, result.maxLength)) {
                    exception.message('Property "minLength" must be less than or equal to "maxLength"');
                }

                if (!minMaxValid(result.minProperties, result.maxProperties)) {
                    exception.message('Property "minProperties" must be less than or equal to "maxProperties"');
                }

                if (!minMaxValid(result.minimum, result.maximum, result.exclusiveMinimum, result.exclusiveMaximum)) {
                    const msg = result.exclusiveMinimum || result.exclusiveMaximum ? '' : 'or equal to ';
                    exception.message('Property "minimum" must be less than ' + msg + '"maximum"');
                }

                if (result.hasOwnProperty('properties')) {
                    Object.keys(result.properties).forEach(key => {
                        const v = result.properties[key];
                        if (v.readOnly && v.writeOnly) {
                            exception.at('properties').at(key).message('Cannot be marked as both readOnly and writeOnly');
                        }
                    });
                }

                // validate that zero or one composite has been defined
                const composites = [];
                ['allOf', 'anyOf', 'oneOf', 'not'].forEach(composite => {
                    if (result.hasOwnProperty(composite)) composites.push(composite);
                });
                if (composites.length > 1) {
                    exception.message('Cannot have multiple composites: ' + composites.join(', '));
                }
            }
        };
    }
};

/**
 * Accepts a function that returns a regular expression. Uses the regular expression to extract parameter names from strings.
 * @param {function} rxGenerator
 * @returns {function}
 */
function buildInjector(rxGenerator) {
    return function(value, data) {
        const rx = rxGenerator();
        let match;
        let result = '';
        let offset = 0;
        while (match = rx.exec(value)) {
            const property = match[1];
            result += value.substring(offset, match.index) + (data[property] !== undefined ? data[property] : match[0]);
            offset = match.index + match[0].length;
        }
        return result + value.substr(offset);
    };
}

function dateIsFrozen() {
    throw Error('Date object cannot be modified');
}

function deserializeAndValidate(schema, exception, value, options) {
    let error;
    [ value, error ] = schema.deserialize(value);
    if (!error) {
        const exception = Exception('Invalid value');
        runValidate(exception, new Map(), schema, value, options);
        if (exception.hasException) error = exception;
    }
    if (error) exception.push(error);
    return value;
}

function freeze (value) {
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date) {
        value.setDate = dateIsFrozen;
        value.setFullYear= dateIsFrozen;
        value.setHours= dateIsFrozen;
        value.setMilliseconds= dateIsFrozen;
        value.setMinutes= dateIsFrozen;
        value.setMonth= dateIsFrozen;
        value.setSeconds= dateIsFrozen;
        value.setTime= dateIsFrozen;
        value.setUTCDate= dateIsFrozen;
        value.setUTCFullYear= dateIsFrozen;
        value.setUTCHours= dateIsFrozen;
        value.setUTCMilliseconds= dateIsFrozen;
        value.setUTCMinutes= dateIsFrozen;
        value.setUTCMonth= dateIsFrozen;
        value.setUTCSeconds= dateIsFrozen;
        value.setYear= dateIsFrozen;
    }
    Object.freeze(value);
    return value;
}

function isSchemaProperty({ parent }) {
    return parent && parent.parent && parent.parent.key === 'properties' &&
        parent.parent.parent && parent.parent.parent.validator === module.exports.validator;
}

function maxMin(exception, schema, type, maxProperty, minProperty, exclusives, value, maximum, minimum) {
    if (schema.hasOwnProperty(maxProperty)) {
        if (exclusives && schema.exclusiveMaximum && value >= maximum) {
            exception.message('Expected ' + type + ' to be less than ' +
                util.smart(schema.serialize(schema[maxProperty]).value) + '. Received: ' +
                util.smart(schema.serialize(value).value));
        } else if (value > maximum) {
            exception.message('Expected ' + type + ' to be less than or equal to ' +
                util.smart(schema.serialize(schema[maxProperty]).value) + '. Received: ' +
                util.smart(schema.serialize(value).value));
        }
    }

    if (schema.hasOwnProperty(minProperty)) {
        if (exclusives && schema.exclusiveMinimum && value <= minimum) {
            exception.message('Expected ' + type + ' to be greater than ' +
                util.smart(schema.serialize(schema[minProperty]).value) + '. Received: ' +
                util.smart(schema.serialize(value).value));
        } else if (value < minimum) {
            exception.message('Expected ' + type + ' to be greater than or equal to ' +
                util.smart(schema.serialize(schema[minProperty]).value) + '. Received: ' +
                util.smart(schema.serialize(value).value));
        }
    }
}

function minMaxValid(minimum, maximum, exclusiveMinimum, exclusiveMaximum) {
    if (minimum === undefined || maximum === undefined) return true;
    minimum = +minimum;
    maximum = +maximum;
    return minimum < maximum || (!exclusiveMinimum && !exclusiveMaximum && minimum === maximum);
}

function numericish(schema) {
    if (['number', 'integer'].includes(schema.type)) return true;
    const dataTypes = schema.enforcerData.staticData.dataTypes;
    const dataType = dataTypes[schema.type] && dataTypes[schema.type][schema.format];
    return !!(dataType && dataType.isNumeric);
}

function numericType (schema) {
    const dataTypes = schema.enforcerData.staticData.dataTypes;
    const dataType = dataTypes[schema.type] && dataTypes[schema.type][schema.format];
    if (dataType && dataType.isNumeric) {
        switch (schema.type) {
            case 'boolean':
                return 'boolean';
            case 'string':
                return 'string';
            case 'integer':
            case 'number':
            default:
                return 'number';
        }
    } else {
        return 'number';
    }
}

function runValidate(exception, map, schema, originalValue, options) {
    const { validate, value } = Value.getAttributes(originalValue);
    if (!validate) return originalValue;

    const type = schema.type;

    // handle cyclic validation
    if (value && typeof value === 'object') {
        let schemas = map.get(value);
        if (schemas && schemas.indexOf(schema) !== -1) return;

        if (!schemas) {
            schemas = [];
            map.set(value, schemas);
        }
        schemas.push(schema);
    }

    // if nullable and null then skip all other validation
    if (schema.nullable && value === null) return;

    if (schema.allOf) {
        const child = exception.nest('Did not validate against allOf schemas');
        schema.allOf.forEach((subSchema, index) => {
            runValidate(child.at(index), map, subSchema, originalValue, options);
        });

    } else if (schema.anyOf) {
        if (schema.discriminator) {
            const data = schema.getDiscriminator(value);
            const subSchema = data.schema;
            const key = data.key;
            if (!subSchema) {
                exception.message('Discriminator property "' + key + '" as "' + value[key] + '" did not map to a schema');
            } else {
                runValidate(exception.at(value[key]), map, subSchema, value, options);
            }
        } else {
            const anyOfException = Exception('Did not validate against one or more anyOf schemas');
            const length = schema.anyOf.length;
            let valid = false;
            for (let i = 0; i < length; i++) {
                const child = anyOfException.at(i);
                runValidate(child, map, schema.anyOf[i], value, options);
                if (!child.hasException) {
                    valid = true;
                    break;
                }
            }
            if (!valid) exception.message(anyOfException);
        }

    } else if (schema.oneOf) {
        if (schema.discriminator) {
            const data = schema.getDiscriminator(value);
            const subSchema = data.schema;
            const key = data.key;
            if (!subSchema) {
                exception.message('Discriminator property "' + key + '" as "' + value[key] + '" did not map to a schema');
            } else {
                runValidate(exception.at(value[key]), map, subSchema, value, options);
            }
        } else {
            const oneOfException = Exception('Did not validate against exactly one oneOf schema');
            const length = schema.oneOf.length;
            let valid = 0;
            for (let i = 0; i < length; i++) {
                const child = Exception('Did not validate against schema at index ' + i);
                runValidate(child, map, schema.oneOf[i], value, options);
                if (!child.hasException) {
                    valid++;
                    oneOfException('Validated against schema at index ' + i);
                } else {
                    oneOfException(child);
                }
            }
            if (valid !== 1) exception.push(oneOfException);
        }

    } else if (schema.not) {
        const child = Exception('');
        runValidate(child, map, schema, value, options);
        if (!child.hasException) exception.message('Value should not validate against schema');

    } else if (type === 'array') {
        if (!Array.isArray(value)) {
            exception.message('Expected an array. Received: ' + util.smart(value));
        } else {
            const length = value.length;
            if (schema.hasOwnProperty('maxItems') && schema.maxItems < length) {
                exception.message('Too many items in the array. Maximum of ' + schema.maxItems + '. Found ' + length + ' items');
            }
            if (schema.hasOwnProperty('minItems') && schema.minItems > length) {
                exception.message('Too few items in the array. Minimum of ' + schema.minItems + '. Found ' + length + ' items');
            }
            if (schema.uniqueItems) {
                const singles = [];
                value.forEach((item, index) => {
                    const length = singles.length;
                    let found;
                    for (let i = 0; i < length; i++) {
                        if (util.same(item, singles[i])) {
                            exception.message('Array items must be unique. Value is not unique at index ' + index);
                            found = true;
                            break;
                        }
                    }
                    if (!found) singles.push(item);
                });
            }
            if (schema.items) {
                value.forEach((val, index) => {
                    runValidate(exception.at(index), map, schema.items, val, options);
                });
            }
        }

    } else if (type === 'object') {
        if (!util.isPlainObject(value)) {
            exception.message('Expected a non-null object. Received: ' + util.smart(value));
        } else {
            const properties = schema.properties || {};
            const required = schema.required ? schema.required.concat() : [];
            const keys = Object.keys(value);
            const knownPropertyException = exception.nest('Error with properties');
            const additionalPropertyException = exception.nest('Error with additional properties');

            // validate each property in the value
            keys.forEach(key => {
                const index = required.indexOf(key);
                if (index !== -1) required.splice(index, 1);
                if (properties.hasOwnProperty(key)) {
                    runValidate(knownPropertyException.at(key), map, properties[key], value[key], options);
                } else {
                    if (schema.additionalProperties === false) {
                        exception.message('Property not allowed: ' + key);
                    } else if (typeof schema.additionalProperties === 'object') {
                        runValidate(additionalPropertyException.at(key), map, schema.additionalProperties, value[key], options);
                    }
                }
            });

            // validate that all required are present
            if (required.length > 0) {
                exception.message('One or more required properties missing: ' + required.join(', '));
            }

            // validate number of properties
            maxMin(exception, schema, 'object property count', 'maxProperties', 'minProperties', false, keys.length, schema.maxProperties, schema.minProperties);

            // if a discriminator is present then validate discriminator mapping
            if (schema.discriminator) {
                const discriminatorSchema = version.getDiscriminatorSchema(schema, value);
                if (discriminatorSchema) {
                    runValidate(exception, map, discriminatorSchema, value, options);
                } else {
                    exception.message('Unable to map discriminator schema');
                }
            }
        }

    } else {
        const dataTypes = schema.enforcerData.staticData.dataTypes;
        const dataType = dataTypes[schema.type][schema.format] || { validate: null };

        if (dataType.validate) {
            dataType.validate({ exception, schema, value });

        } else if (type === 'boolean') {
            if (typeof value !== 'boolean') exception.message('Expected a boolean. Received: ' + util.smart(value));

        } else if (type === 'integer') {
            if (isNaN(value) || Math.round(value) !== value || typeof value !== 'number') {
                exception.message('Expected an integer. Received: ' + util.smart(value));
            } else {
                if (options.maxMin !== false) {
                    maxMin(exception, schema, 'integer', 'maximum', 'minimum', true, value, schema.maximum, schema.minimum);
                }
                if (schema.multipleOf && value % schema.multipleOf !== 0) {
                    exception.message('Expected a multiple of ' + schema.multipleOf + '. Received: ' + util.smart(value));
                }
            }

        } else if (type === 'number') {
            if (isNaN(value) || typeof value !== 'number') {
                exception.message('Expected a number. Received: ' + util.smart(value));
            } else {
                if (options.maxMin !== false) {
                    maxMin(exception, schema, 'number', 'maximum', 'minimum', true, value, schema.maximum, schema.minimum);
                }
                if (schema.multipleOf && value % schema.multipleOf !== 0) {
                    exception.message('Expected a multiple of ' + schema.multipleOf + '. Received: ' + util.smart(value));
                }
            }

        } else if (schema.type === 'string') {
            if (typeof value !== 'string') {
                exception.message('Expected a string. Received: ' + util.smart(value));
            } else {
                const length = value.length;
                if (schema.hasOwnProperty('maxLength') && length > schema.maxLength) {
                    exception.message('String too long. ' + util.smart(value) + ' (' + length + ') exceeds maximum length of ' + schema.maxLength);
                }

                if (schema.hasOwnProperty('minLength') && length < schema.minLength) {
                    exception.message('String too short. ' + util.smart(value) + ' (' + length + ') exceeds minimum length of ' + schema.minLength);
                }

                if (schema.hasOwnProperty('pattern') && !schema.pattern.test(value)) {
                    exception.message('String does not match required pattern ' + schema.pattern + ' with value: ' + util.smart(value));
                }
            }
        }
    }

    // enum validation
    if (schema.enum && options.enum !== false) {
        const length = schema.enum.length;
        let found;
        for (let i = 0; i < length; i++) {
            if (util.same(value, schema.enum[i])) {
                found = true;
                break;
            }
        }
        if (!found) exception.message('Value ' + util.smart(value) + ' did not meet enum requirements');
    }
}

function setProperty(object, property, value) {
    Object.defineProperty(object, property, {
        configurable: true,
        enumerable: true,
        value
    });
}